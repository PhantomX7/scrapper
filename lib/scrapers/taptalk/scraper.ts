import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ChatMessage,
  ChatRow,
  ScrapeLog,
  ScrapeLogLevel,
} from '../../../app/scrape-types'
import type { ScrapeContext, ScrapeOutput } from '../types'

export type TaptalkInput = {
  email: string
  password: string
  maxChats: number
  dateFrom?: string // YYYY-MM-DD; blank = today
  dateTo?: string // YYYY-MM-DD; blank = same as dateFrom
}

const DATA_DIR = path.join(process.cwd(), '.data')
const STORAGE_DIR = path.join(DATA_DIR, 'storage')
const ARTIFACT_DIR = path.join(DATA_DIR, 'artifacts')
const LOGIN_URL = 'https://onetalk.taptalk.io/login'

// OneTalk-specific anchors.
// Prefer text-based selectors where available — they survive DOM reshuffles that break xpath.
const SEARCH_TAB_SELECTOR = '.side-panel-account-button:has-text("Search")'
const DATE_FILTER_XPATH = '//*[@id="root"]/div/div[4]/div[1]/div[2]/div[1]/div[1]/div[2]/div[2]'
const APPLY_BTN_XPATH = '/html/body/div[2]/div/div[1]/div/div/div[2]/button[3]'

function storageStatePath(ctx: ScrapeContext): string {
  // One file per (company, service) so different OneTalk accounts don't share
  // login cookies. Slug is sanitized at the company-create boundary.
  return path.join(STORAGE_DIR, `${ctx.companySlug}-${ctx.service}.json`)
}

function artifactDirFor(ctx: ScrapeContext): string {
  return path.join(ARTIFACT_DIR, `${ctx.companySlug}-${ctx.service}`)
}

export async function scrapeChatList(
  input: TaptalkInput,
  ctx: ScrapeContext,
): Promise<ScrapeOutput> {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true })
  const artifactDir = artifactDirFor(ctx)
  if (!existsSync(artifactDir)) mkdirSync(artifactDir, { recursive: true })
  const STORAGE_STATE = storageStatePath(ctx)

  const logs: ScrapeLog[] = []
  const artifacts: { label: string; relativePath: string }[] = []
  const log = (level: ScrapeLogLevel, message: string) => {
    logs.push({ level, message, at: new Date().toISOString() })
  }
  const addArtifact = (label: string, absPath: string) => {
    artifacts.push({ label, relativePath: path.relative(process.cwd(), absPath) })
  }

  let browser: Browser | undefined
  let context: BrowserContext | undefined

  try {
    log('info', 'Launching headless Chromium…')
    browser = await chromium.launch({ headless: true })

    const hasSavedState = existsSync(STORAGE_STATE)
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(hasSavedState ? { storageState: STORAGE_STATE } : {}),
    })
    if (hasSavedState) log('info', 'Reusing saved session from previous run.')

    const page = await context.newPage()

    log('info', `Navigating to ${LOGIN_URL}`)
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // Let the SPA consume the saved session and either redirect us to /home
    // (auth good) or stay/bounce back to /login (saved cookies rejected). On
    // domcontentloaded alone, page.url() flips between /login → /home → /login
    // as the auth check runs, and reading it during that window can falsely
    // indicate "logged in" — which then crashes downstream when the scraper
    // tries to drive an inbox UI that isn't there.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(800)

    if (await needsLogin(page)) {
      if (hasSavedState) {
        log(
          'warn',
          'Saved session was rejected (likely expired) — falling back to fresh login.',
        )
      } else {
        log('info', 'Login page detected. Submitting credentials…')
      }
      await performLogin(page, input.email, input.password, log)

      try {
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 })
      } catch {
        log('error', `Still on login page after submit: ${page.url()}`)
        addArtifact('Login failure screenshot', await saveScreenshot(page, artifactDir, 'login-failed'))
        return { chats: [], logs, artifacts, landingUrl: page.url() }
      }

      await context.storageState({ path: STORAGE_STATE })
      log('info', 'Login successful, session saved.')
    } else {
      log('info', 'Already authenticated via saved session.')
    }

    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    log('info', `Landed on ${page.url()}`)

    await dumpState(page, artifactDir, 'post-login', addArtifact)

    try {
      await openSearchAndApplyDateFilter(
        page,
        log,
        (stage) => dumpState(page, artifactDir, stage, addArtifact),
        input.dateFrom,
        input.dateTo,
      )
    } catch (err) {
      await dumpState(page, artifactDir, 'click-flow-failed', addArtifact)
      throw err
    }

    await dumpState(page, artifactDir, 'inbox', addArtifact)

    log('info', 'Scrolling virtualized chat list…')
    const rawRows = await collectVirtualizedChats(page, log)
    log('info', `Collected ${rawRows.length} unique chat row(s).`)

    const targetRows = rawRows.slice(0, input.maxChats)
    log('info', `Fetching case detail fields + first message for ${targetRows.length} chat(s)…`)
    let diagnosticsDumped = false
    for (let i = 0; i < targetRows.length; i++) {
      const r = targetRows[i]
      try {
        const detail = await fetchCaseDetailFields(page, r)
        const summary = await fetchChatSummary(page).catch(
          () => ({ messages: [] }) as {
            firstMessage?: string
            messages: ChatMessage[]
          },
        )
        const contactPhone = await fetchContactPhone(page).catch(() => undefined)
        targetRows[i] = {
          ...r,
          ...detail,
          firstMessageText: summary.firstMessage,
          messages: summary.messages,
          contactPhone,
        }
      } catch (err) {
        const msg = (err as Error).message
        log('warn', `Detail fetch failed for ${r.caseId ?? r.roomId} (${r.name}): ${msg}`)
        // First failure gets a full diagnostic dump so we can see exactly what
        // the detail pane looked like when the wait timed out.
        if (!diagnosticsDumped) {
          diagnosticsDumped = true
          try {
            const snapshot = await snapshotDetailPane(page)
            log(
              'warn',
              `Detail pane snapshot (first failure · row ${r.caseId ?? r.roomId}): ${JSON.stringify(snapshot)}`,
            )
            await dumpState(page, artifactDir, `detail-fail-${r.caseId ?? r.roomId}`, addArtifact)
          } catch (dumpErr) {
            log('warn', `Diagnostic dump failed: ${(dumpErr as Error).message}`)
          }
        }
      }
      if ((i + 1) % 5 === 0 || i === targetRows.length - 1) {
        log('info', `  detail progress ${i + 1}/${targetRows.length}`)
      }
    }

    const chats = targetRows.map((r) => parseRow(r))

    return { chats, logs, artifacts, landingUrl: page.url() }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', `Scraper crashed: ${msg}`)
    return { chats: [], logs, artifacts }
  } finally {
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
}

async function dumpState(
  page: Page,
  dir: string,
  label: string,
  addArtifact: (label: string, absPath: string) => void,
) {
  try {
    const shot = path.join(dir, `${label}.png`)
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
    addArtifact(`${label} screenshot`, shot)
    const html = path.join(dir, `${label}.html`)
    await writeFile(html, await page.content(), 'utf8')
    addArtifact(`${label} HTML`, html)
  } catch {
    // ignore — best effort
  }
}

async function openSearchAndApplyDateFilter(
  page: Page,
  log: (level: ScrapeLogLevel, message: string) => void,
  onStage: (stage: string) => Promise<void>,
  dateFromStr: string | undefined,
  dateToStr: string | undefined,
) {
  log('info', `Clicking Search tab (${SEARCH_TAB_SELECTOR})…`)
  try {
    await page.locator(SEARCH_TAB_SELECTOR).first().click({ timeout: 15_000 })
  } catch (err) {
    await onStage('before-search-click')
    throw new Error(`Search tab click failed: ${(err as Error).message}`)
  }
  await page.waitForTimeout(600)

  log('info', 'Opening date filter…')
  try {
    await page.locator(`xpath=${DATE_FILTER_XPATH}`).click({ timeout: 15_000 })
  } catch (err) {
    await onStage('before-date-filter-click')
    throw new Error(`Date filter button click failed: ${(err as Error).message}`)
  }
  try {
    await page.waitForSelector('#date-filter-wrapper', { state: 'visible', timeout: 15_000 })
  } catch (err) {
    await onStage('date-picker-never-opened')
    throw new Error(`Date picker did not open: ${(err as Error).message}`)
  }

  let from = dateFromStr ? parseYMD(dateFromStr) : startOfToday()
  let to = dateToStr ? parseYMD(dateToStr) : new Date(from)
  if (to < from) {
    log('warn', 'Date to is before Date from — swapping.')
    ;[from, to] = [to, from]
  }
  log('info', `Range target: ${formatAriaLabel(from)} → ${formatAriaLabel(to)}`)

  log('info', `Selecting range start (${formatAriaLabel(from)})…`)
  try {
    await selectDateInPicker(page, from)
  } catch (err) {
    await onStage('before-range-start-click')
    throw new Error(`Range start selection failed: ${(err as Error).message}`)
  }
  await page.waitForTimeout(300)

  log('info', `Selecting range end (${formatAriaLabel(to)})…`)
  try {
    await selectDateInPicker(page, to)
  } catch (err) {
    await onStage('before-range-end-click')
    throw new Error(`Range end selection failed: ${(err as Error).message}`)
  }
  await page.waitForTimeout(300)

  log('info', 'Clicking Apply…')
  try {
    await page.locator(`xpath=${APPLY_BTN_XPATH}`).click({ timeout: 15_000 })
  } catch (err) {
    await onStage('before-apply-click')
    throw new Error(`Apply button click failed: ${(err as Error).message}`)
  }

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(3000)
}

async function selectDateInPicker(page: Page, target: Date) {
  const ariaLabel = formatAriaLabel(target)
  const targetMonth = new Date(target.getFullYear(), target.getMonth(), 1).getTime()

  for (let i = 0; i < 36; i++) {
    const cell = page
      .locator(
        `#date-filter-wrapper .DayPicker-Day[aria-label="${ariaLabel}"]:not(.DayPicker-Day--outside)`,
      )
      .first()
    if ((await cell.count()) > 0) {
      await cell.click({ timeout: 5_000 })
      return
    }

    const captions = await page
      .locator('#date-filter-wrapper .DayPicker-Caption div')
      .allTextContents()
    const visibleMonths = captions
      .map(parseMonthCaption)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime())
    if (visibleMonths.length === 0) throw new Error('Could not read month captions')
    const minVisible = Math.min(...visibleMonths)
    const maxVisible = Math.max(...visibleMonths)

    if (targetMonth < minVisible) {
      const prev = page.locator('#date-filter-wrapper .DayPicker-NavButton--prev').first()
      if ((await prev.count()) === 0) throw new Error('Prev nav button not found')
      await prev.click()
    } else if (targetMonth > maxVisible) {
      const next = page
        .locator(
          '#date-filter-wrapper .DayPicker-NavButton--next:not(.DayPicker-NavButton--interactionDisabled)',
        )
        .first()
      if ((await next.count()) === 0) {
        throw new Error(
          `Next nav button disabled — target ${ariaLabel} may be beyond the allowed range (future?).`,
        )
      }
      await next.click()
    } else {
      await page.waitForTimeout(150)
    }
    await page.waitForTimeout(150)
  }
  throw new Error(`Gave up navigating picker to ${ariaLabel}`)
}

function formatAriaLabel(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${pad(d.getDate())} ${d.getFullYear()}`
}

function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function parseMonthCaption(text: string): Date | null {
  const m = text.trim().match(/^(\w+)\s+(\d{4})$/)
  if (!m) return null
  const idx = MONTH_NAMES.indexOf(m[1])
  if (idx < 0) return null
  return new Date(Number(m[2]), idx, 1)
}

async function needsLogin(page: Page): Promise<boolean> {
  if (page.url().includes('/login')) return true
  return page.locator('input[type="password"]').first().isVisible().catch(() => false)
}

async function performLogin(
  page: Page,
  email: string,
  password: string,
  log: (level: ScrapeLogLevel, message: string) => void,
) {
  const emailInput = page
    .locator(
      'input[type="email"], input[name*="email" i], input[name*="user" i], input[autocomplete="username"]',
    )
    .first()
  const passwordInput = page.locator('input[type="password"]').first()

  try {
    await emailInput.waitFor({ state: 'visible', timeout: 15_000 })
    await emailInput.fill(email)
  } catch {
    log('warn', 'No dedicated email field — using first visible text input.')
    await page
      .locator('input:not([type="hidden"]):not([type="password"])')
      .first()
      .fill(email)
  }

  await passwordInput.fill(password)

  const submit = page
    .locator(
      'button[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in"), button:has-text("Masuk")',
    )
    .first()

  if ((await submit.count()) > 0) await submit.click()
  else {
    log('warn', 'No submit button found — pressing Enter on password field.')
    await passwordInput.press('Enter')
  }
}

async function saveScreenshot(page: Page, dir: string, label: string): Promise<string> {
  const file = path.join(dir, `${label}.png`)
  await page.screenshot({ path: file, fullPage: true }).catch(() => {})
  return file
}

type RawRow = {
  roomId: string
  caseId?: string
  name: string
  timestamp?: string
  preview?: string
  previewSender?: string
  status?: string
  assignee?: string
  topPx: number
  caseCreatedText?: string
  firstResponseText?: string
  firstResponseWaitText?: string
  resolvedText?: string
  caseDurationText?: string
  firstMessageText?: string
  contactPhone?: string
  messages?: ChatMessage[]
}

type CaseDetailFields = {
  caseCreatedText?: string
  firstResponseText?: string
  firstResponseWaitText?: string
  resolvedText?: string
  caseDurationText?: string
}

const DETAIL_LABELS: string[] = [
  'Case Created Time',
  'First Response Time',
  'First Response Wait Duration',
  'Resolved Time',
  'Case Duration',
]

async function collectVirtualizedChats(
  page: Page,
  log: (level: ScrapeLogLevel, message: string) => void,
): Promise<RawRow[]> {
  const result = await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const scroller = document.querySelector('.all-case-list') as HTMLElement | null
    if (!scroller) return { error: 'scroller-not-found' as const }

    // The react-virtualized sizer is the tall inner div whose inline height tracks
    // total list height. It grows as the infinite loader appends more rooms.
    const findSizer = (): HTMLElement | null =>
      (Array.from(scroller.children).find((c) => {
        const el = c as HTMLElement
        return parseFloat(el.style.height || '0') > 50
      }) as HTMLElement | null) ?? null

    let sizer = findSizer()
    if (!sizer) return { error: 'sizer-not-found' as const }

    const getHeight = () => {
      const s = findSizer()
      if (s) sizer = s
      return sizer ? parseFloat(sizer.style.height || '0') : 0
    }

    const collected = new Map<string, RawRowIn>()

    type RawRowIn = {
      roomId: string
      caseId?: string
      name: string
      timestamp?: string
      preview?: string
      previewSender?: string
      status?: string
      assignee?: string
      topPx: number
    }

    const text = (el: Element | null | undefined) => el?.textContent?.trim() || undefined

    const snapshot = () => {
      // Query from the scroller, not the cached sizer — the sizer element can be
      // replaced when the virtualizer re-renders after more items load.
      const wrappers = scroller.querySelectorAll<HTMLElement>('.new-case-list-wrapper')
      wrappers.forEach((wrap) => {
        const roomId = wrap.getAttribute('data-room-id')
        if (!roomId || collected.has(roomId)) return

        const positioned = wrap.closest('[style*="position: absolute"]') as HTMLElement | null
        const topPx = positioned ? parseFloat(positioned.style.top || '0') : 0

        const name = text(wrap.querySelector('.chat-roomname b')) ?? '(unknown)'
        const timestamp = text(wrap.querySelector('.chat-timestamp'))
        const caseIdText = text(wrap.querySelector('.chat-case-id b'))
        const caseId = caseIdText?.replace(/^#/, '')

        const lastMsgEl = wrap.querySelector('.chat-last-message p')
        const senderEl = lastMsgEl?.querySelector('.chat-last-message-room')
        const previewSender = text(senderEl)?.replace(/:\s*$/, '')
        let preview: string | undefined
        if (lastMsgEl) {
          const full = lastMsgEl.textContent?.trim() ?? ''
          const senderText = senderEl?.textContent ?? ''
          preview = full.startsWith(senderText) ? full.slice(senderText.length).trim() : full
        }

        const status = text(wrap.querySelector('.agent-badge-new'))
        const assignee = text(wrap.querySelector('.agent-badge.other-agent-badge'))

        collected.set(roomId, {
          roomId,
          caseId,
          name,
          timestamp,
          preview,
          previewSender,
          status,
          assignee,
          topPx,
        })
      })
    }

    const viewport = scroller.clientHeight
    const step = Math.max(200, viewport - 150)

    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event('scroll'))
    await sleep(400)
    snapshot()

    const initialHeight = getHeight()
    // Infinite scroll: keep advancing until the list stops growing AND no new rows
    // appear after a handful of bottom-pokes. `stalls` counts consecutive bottom
    // visits that produced no new height and no new rows.
    const maxStalls = 6
    const maxIterations = 2000
    let stalls = 0
    let lastHeight = initialHeight
    let lastCount = collected.size
    let top = 0

    for (let i = 0; i < maxIterations; i++) {
      const height = getHeight()
      const bottom = Math.max(0, height - viewport)

      top = Math.min(top + step, bottom)
      scroller.scrollTop = top
      scroller.dispatchEvent(new Event('scroll'))
      await sleep(350)
      snapshot()

      // Reached (or already at) the current bottom — wait longer to let the
      // infinite loader append the next page, then re-measure.
      if (top >= bottom - 1) {
        // Nudge the scroll to force an onScroll event even if scrollTop didn't change.
        scroller.scrollTop = bottom
        scroller.dispatchEvent(new Event('scroll'))
        await sleep(800)
        snapshot()

        const newHeight = getHeight()
        const grew = newHeight > lastHeight + 1 || collected.size > lastCount
        if (grew) {
          stalls = 0
          lastHeight = newHeight
          lastCount = collected.size
          // Don't exit — let the next iteration advance further into the new region.
        } else {
          stalls++
          if (stalls >= maxStalls) break
          // Try jiggling back up a bit and down again; some virtualizers need it.
          scroller.scrollTop = Math.max(0, bottom - step)
          scroller.dispatchEvent(new Event('scroll'))
          await sleep(200)
          scroller.scrollTop = bottom
          scroller.dispatchEvent(new Event('scroll'))
          await sleep(400)
          snapshot()
        }
      }
    }

    return {
      error: null,
      initialHeight,
      finalHeight: lastHeight,
      viewport,
      stalls,
      rows: Array.from(collected.values()),
    }
  })

  if (result.error) {
    log('error', `Chat list extraction: ${result.error}`)
    return []
  }

  log(
    'info',
    `Sizer height grew ${result.initialHeight}px → ${result.finalHeight}px · viewport ${result.viewport}px · bottom stalls ${result.stalls}`,
  )
  return [...result.rows].sort((a, b) => a.topPx - b.topPx)
}

async function fetchCaseDetailFields(page: Page, r: RawRow): Promise<CaseDetailFields> {
  await page.evaluate((topPx: number) => {
    const scroller = document.querySelector<HTMLElement>('.all-case-list')
    if (scroller) scroller.scrollTop = Math.max(0, topPx - 100)
  }, r.topPx)
  await page.waitForTimeout(250)

  const row = page.locator(`.new-case-list-wrapper[data-room-id="${r.roomId}"]`).first()
  await row.waitFor({ state: 'attached', timeout: 10_000 })
  const clickArea = row.locator('.click-area-case-list').first()
  if ((await clickArea.count()) > 0) {
    await clickArea.click({ timeout: 10_000 })
  } else {
    await row.click({ timeout: 10_000 })
  }

  // The previous row's fetchContactPhone leaves the detail pane on Contact Info,
  // which hides the Case ID field the wait below depends on. Switch back to the
  // Case Detail tab. We drive the click in page context instead of via a Playwright
  // locator so we can enumerate every `.user-info-tab-content` element and pick the
  // one whose text is NOT "Contact Info" — safer than guessing the Case Detail tab's
  // actual label.
  await switchToCaseDetailTab(page)

  // Wait until the detail panel has switched to this case. If we know the caseId,
  // require Case ID to match so we don't read stale values from the previous row.
  if (r.caseId) {
    await page.waitForFunction(
      (expected: string) => {
        const wrappers = document.querySelectorAll('.user-info-list-wrapper')
        for (const el of wrappers) {
          const label = el.querySelector('label b')?.textContent?.trim()
          if (label === 'Case ID') {
            const value = el.querySelector('.user-info-box-wrapper')?.textContent?.trim()
            return value === expected
          }
        }
        return false
      },
      r.caseId,
      { timeout: 15_000 },
    )
  } else {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.user-info-list-wrapper')).some(
          (el) => el.querySelector('label b')?.textContent?.trim() === 'Case Created Time',
        ),
      undefined,
      { timeout: 15_000 },
    )
  }

  return page.evaluate((labels) => {
    const want = new Set(labels)
    const out: Record<string, string | undefined> = {}
    const wrappers = document.querySelectorAll('.user-info-list-wrapper')
    for (const el of wrappers) {
      const label = el.querySelector('label b')?.textContent?.trim()
      if (!label || !want.has(label)) continue
      const valueEl = el.querySelector('.user-info-box-wrapper')
      const value = valueEl?.textContent?.trim()
      if (value) out[label] = value
    }
    return {
      caseCreatedText: out['Case Created Time'],
      firstResponseText: out['First Response Time'],
      firstResponseWaitText: out['First Response Wait Duration'],
      resolvedText: out['Resolved Time'],
      caseDurationText: out['Case Duration'],
    }
  }, DETAIL_LABELS)
}

// Scrolls the open chat pane to the top so older messages lazy-load, then walks
// every message wrapper extracting direction/body/attachments/timestamps.
async function fetchChatSummary(
  page: Page,
): Promise<{ firstMessage?: string; messages: ChatMessage[] }> {
  await page
    .waitForSelector('.chat-room-main-content', { state: 'attached', timeout: 10_000 })
    .catch(() => null)

  const result = await page.evaluate(
    async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

      const container = document.querySelector<HTMLElement>('.chat-room-main-content')
      if (!container) return { firstMessage: null, messages: [] }

      // TapTalk wraps the message list in a custom scrollbar container, so walk up
      // to find the actually-scrollable ancestor.
      const findScroller = (start: HTMLElement): HTMLElement => {
        let el: HTMLElement | null = start
        while (el) {
          const s = getComputedStyle(el)
          const ov = `${s.overflow} ${s.overflowY}`
          if (/auto|scroll/.test(ov) && el.scrollHeight > el.clientHeight) return el
          el = el.parentElement
        }
        return start
      }
      const scroller = findScroller(container)

      // Scroll to top until the scroll height stops growing and we're pinned at
      // scrollTop=0 for several consecutive checks — older messages have fully
      // lazy-loaded at that point.
      let lastHeight = scroller.scrollHeight
      let stalls = 0
      const maxStalls = 4
      for (let i = 0; i < 80; i++) {
        scroller.scrollTop = 0
        scroller.dispatchEvent(new Event('scroll'))
        await sleep(400)
        const h = scroller.scrollHeight
        if (h === lastHeight && scroller.scrollTop === 0) {
          stalls++
          if (stalls >= maxStalls) break
        } else {
          stalls = 0
          lastHeight = h
        }
      }

      type Msg = {
        id: string
        direction: 'in' | 'out' | 'info'
        senderName?: string
        isAgent?: boolean
        body?: string
        imageUrl?: string
        fileName?: string
        caption?: string
        replyToName?: string
        replyToText?: string
        timestamp?: string
      }

      const extractTimestamp = (el: Element | null | undefined): string | undefined => {
        if (!el) return undefined
        const clone = el.cloneNode(true) as HTMLElement
        clone.querySelectorAll('img').forEach((i) => i.remove())
        const txt = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim()
        return txt || undefined
      }

      const messages: Msg[] = []
      const children = Array.from(container.children) as HTMLElement[]
      for (const el of children) {
        const cls = el.className || ''
        const rawId = el.id || ''
        const id = rawId.replace(/^message-/, '') || `idx-${messages.length}`

        if (cls.includes('chat-room-info-wrapper')) {
          const body = (
            el.querySelector<HTMLElement>('.chat-room-info-content')?.innerText ??
            el.querySelector('.chat-room-info-content')?.textContent ??
            ''
          ).trim()
          messages.push({ id, direction: 'info', body: body || undefined })
          continue
        }

        const isIn = /chat-room-message-(image-|file-)?in-wrapper/.test(cls)
        const isOut = /chat-room-message-(image-|file-)?out-wrapper/.test(cls)
        if (!isIn && !isOut) continue

        // Sender label — for outbound, it's "Agent - <agent name>" with an
        // `agent-span` wrapping the "Agent - " prefix. Strip that prefix so we
        // keep just the name, and record the agent flag separately.
        let senderName: string | undefined
        let isAgent = false
        const senderB = el.querySelector<HTMLElement>('.group-sender-name-wrapper b')
        if (senderB) {
          const agentSpan = senderB.querySelector<HTMLElement>('.agent-span')
          if (agentSpan) {
            isAgent = true
            const prefix = agentSpan.textContent ?? ''
            const full = senderB.textContent ?? ''
            senderName = full.startsWith(prefix) ? full.slice(prefix.length).trim() : full.trim()
          } else {
            senderName = (senderB.textContent ?? '').trim() || undefined
          }
        }

        // `.message-body` lives at different depths depending on bubble type
        // (text / image-with-caption / reply). Pick the first one inside this
        // wrapper — caption text is handled separately below.
        const bodyEl = el.querySelector<HTMLElement>(':scope .message-body')
        const body = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '').trim() : undefined

        // Image (only count the primary bubble image, not any icons inside
        // dropdowns — the first `img.image-from-url` inside the bubble).
        const imgEl = el.querySelector<HTMLImageElement>('img.image-from-url')
        const imageUrl = imgEl?.getAttribute('src') || undefined

        // Caption (images can have a caption below the image).
        const captionEl = el.querySelector<HTMLElement>('.caption-text')
        const caption = captionEl
          ? (captionEl.innerText || captionEl.textContent || '').trim() || undefined
          : undefined

        // File attachment — name text in the file bubble.
        const fileNameEl = el.querySelector<HTMLElement>('.message-bubble-file-wrapper p b')
        const fileName = fileNameEl
          ? (fileNameEl.textContent || '').trim() || undefined
          : undefined

        // Reply-to preview (quoted original).
        const replyNameEl = el.querySelector(
          '.reply-message-in-bubble-reply-name, .reply-message-out-bubble-reply-name',
        )
        const replyTextEl = el.querySelector(
          '.reply-message-in-bubble-reply-text, .reply-message-out-bubble-reply-text',
        )
        const replyToName = replyNameEl ? (replyNameEl.textContent || '').trim() || undefined : undefined
        const replyToText = replyTextEl ? (replyTextEl.textContent || '').trim() || undefined : undefined

        const timestamp = extractTimestamp(el.querySelector('.message-info'))

        messages.push({
          id,
          direction: isIn ? 'in' : 'out',
          senderName,
          isAgent: isAgent || undefined,
          body: body || undefined,
          imageUrl,
          fileName,
          caption,
          replyToName,
          replyToText,
          timestamp,
        })
      }

      let firstMessage: string | null = null
      for (const m of messages) {
        if (m.direction === 'info') continue
        const haystack = [m.body, m.caption, m.fileName].filter(Boolean).join(' ').trim()
        if (!haystack) continue
        firstMessage = haystack
        break
      }

      return { firstMessage, messages }
    },
  )

  return {
    firstMessage: result.firstMessage ?? undefined,
    messages: result.messages,
  }
}

// Clicks whichever `.user-info-tab-content` tab is NOT "Contact Info". We locate
// the tab by index in page context (to match on text) but fire the click through
// Playwright's locator so it dispatches a real mouse event — `el.click()` from
// evaluate can skip React's synthetic event pipeline on some builds, which is
// why the pane would stay stuck on Contact Info across rows. Retries once if the
// detail pane wrapper doesn't become visible.
async function switchToCaseDetailTab(page: Page): Promise<void> {
  // Wait for the tab bar to render after the row click. If it never shows up the
  // Case ID wait downstream will fail loudly — better than silently polling for 15s.
  await page
    .waitForSelector('.user-info-tab-content', { state: 'attached', timeout: 5_000 })
    .catch(() => null)

  const pickTab = async (): Promise<number> =>
    page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll<HTMLElement>('.user-info-tab-content'))
      return tabs.findIndex((t) => {
        const text = (t.innerText || t.textContent || '').trim()
        return !text.includes('Contact Info')
      })
    })

  const isCaseDetailVisible = async (): Promise<boolean> =>
    page.evaluate(() => {
      const w = document.querySelector<HTMLElement>('.chat-room-case-detail-tab-wrapper')
      return !!w && w.offsetParent !== null
    })

  for (let attempt = 0; attempt < 2; attempt++) {
    if (await isCaseDetailVisible()) return
    const index = await pickTab()
    if (index < 0) return // no non-Contact-Info tab rendered
    await page
      .locator('.user-info-tab-content')
      .nth(index)
      .click({ timeout: 5_000 })
      .catch(() => {})
    await page.waitForTimeout(300)
    if (await isCaseDetailVisible()) return
  }
}

// Collects whatever the detail pane is currently showing — tab labels, pane
// wrapper class, and the list of user-info labels. Dumped on first failure so
// we can see if the pane is stuck on Contact Info, empty, showing a prior
// case's data, etc.
async function snapshotDetailPane(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('.user-info-tab-content')).map(
      (t) => ({
        text: (t.innerText || t.textContent || '').trim(),
        classes: t.className,
      }),
    )
    const paneWrappers = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.chat-room-case-detail-tab-wrapper, .chat-room-user-info-tab-wrapper',
      ),
    ).map((w) => ({ classes: w.className, visible: w.offsetParent !== null }))
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>('.user-info-list-wrapper label b'),
    )
      .map((b) => (b.textContent || '').trim())
      .filter(Boolean)
    const caseIdValue = (() => {
      for (const el of document.querySelectorAll('.user-info-list-wrapper')) {
        const label = el.querySelector('label b')?.textContent?.trim()
        if (label === 'Case ID')
          return el.querySelector('.user-info-box-wrapper')?.textContent?.trim() ?? null
      }
      return null
    })()
    return { tabs, paneWrappers, labels, caseIdValue, url: location.href }
  })
}

// Clicks the "Contact Info" tab in the right-hand detail pane and reads the
// phone number input. Leaves the pane on Contact Info — the next row's
// fetchCaseDetailFields call is responsible for switching back to Case Detail.
async function fetchContactPhone(page: Page): Promise<string | undefined> {
  const tab = page.locator('.user-info-tab-content', { hasText: 'Contact Info' }).first()
  if ((await tab.count()) === 0) return undefined
  await tab.click({ timeout: 10_000 })

  // Wait for the phone input to render. It exists even when empty (placeholder "-"),
  // so attached is enough — value-presence is checked below.
  await page
    .waitForSelector('#copy-phone-detail', { state: 'attached', timeout: 10_000 })
    .catch(() => null)

  const phone = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#copy-phone-detail')
    if (!input) return null
    const v = input.value?.trim()
    if (!v || v === '-') return null
    return v
  })

  return phone ?? undefined
}

function parseCaseCreatedText(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return undefined
  const [, dd, mm, yyyy, hh, min, sec] = m
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(sec ?? 0))
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function parseRow(raw: RawRow): ChatRow {
  const createdFromDetail = parseCaseCreatedText(raw.caseCreatedText)
  let createdAt = createdFromDetail ?? new Date().toISOString()
  if (!createdFromDetail && raw.timestamp) {
    const m = raw.timestamp.match(/^(\d{1,2}):(\d{2})$/)
    if (m) {
      const d = new Date()
      d.setHours(Number(m[1]), Number(m[2]), 0, 0)
      createdAt = d.toISOString()
    }
  }

  return {
    id: raw.caseId ?? raw.roomId,
    name: raw.name,
    createdAt,
    firstResponseAt: parseCaseCreatedText(raw.firstResponseText),
    firstResponseWait: raw.firstResponseWaitText,
    resolvedAt: parseCaseCreatedText(raw.resolvedText),
    caseDuration: raw.caseDurationText,
    firstMessage: raw.firstMessageText,
    contactPhone: raw.contactPhone,
    messages: raw.messages,
  }
}
