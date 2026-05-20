'use server'

import { revalidatePath } from 'next/cache'
import type { ScrapeResult, ScrapeLog, ScrapeSummary } from './scrape-types'
import type { CreateCompanyState } from './actions-types'
import { ensureMigrated, getDb } from '../lib/db/client'
import { createCompaniesRepository } from '../lib/db/repositories'
import { SERVICES, type Service } from '../lib/db/schema'
import { getAdapter } from '../lib/scrapers/registry'
import {
  clearScopeCookies,
  readScopeCookies,
  writeScopeCookies,
  writeThemeCookie,
  type ThemePreference,
} from './_lib/preferences'

function isService(value: unknown): value is Service {
  return typeof value === 'string' && (SERVICES as readonly string[]).includes(value)
}

// Run the active scope's adapter. Scope comes from the cookie (set via the
// global ScopeSwitcher) so the form doesn't have to thread companyId/service
// through hidden inputs anymore.
export async function runScrape(
  _prev: ScrapeResult,
  formData: FormData,
): Promise<ScrapeResult> {
  const now = () => new Date().toISOString()

  const { companyId, service } = await readScopeCookies()
  if (!companyId || !service) {
    return errorResult(
      'No active scope. Pick a company and service from the top nav.',
      now,
    )
  }

  ensureMigrated()
  const company = createCompaniesRepository(getDb()).findById(companyId)
  if (!company) {
    return errorResult(
      'Active company no longer exists — pick another from the top nav.',
      now,
    )
  }

  const adapter = getAdapter(service)
  let input: unknown
  try {
    input = adapter.parseInput(formData)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResult(msg, now)
  }

  const preLogs: ScrapeLog[] = [
    {
      level: 'info',
      message: `Company: ${company.name} (${company.slug}) · service: ${adapter.label}`,
      at: now(),
    },
  ]

  try {
    const result = await adapter.scrape(input as never, {
      companyId: company.id,
      companySlug: company.slug,
      service: adapter.service,
    })

    const allLogs = [...preLogs, ...result.logs]

    if (result.chats.length === 0) {
      return {
        status: 'error',
        error:
          "Scraper ran but didn't extract any chats. Check the saved artifacts to see what the scraper saw.",
        logs: allLogs,
        artifacts: result.artifacts,
        isMock: false,
        ranAt: now(),
      }
    }

    // Auto-persist every successful scrape. Upserts are idempotent on
    // (companyId, service, externalId), so re-runs just refresh the rows.
    const persistLogs: ScrapeLog[] = []
    let summary: ScrapeSummary | undefined
    try {
      const { persistScrapedChats } = await import('../lib/db/service')
      const stats = persistScrapedChats(
        { companyId: company.id, service: adapter.service },
        result.chats,
      )
      const messageTotal = result.chats.reduce(
        (acc, c) => acc + (c.messages?.length ?? 0),
        0,
      )
      summary = {
        chats: stats.chatsUpserted,
        messages: messageTotal,
        contacts: stats.contactsUpserted,
        companyName: company.name,
        companySlug: company.slug,
        service: adapter.service,
      }
      persistLogs.push({
        level: 'info',
        message: `Saved to DB · ${stats.chatsUpserted} chat${stats.chatsUpserted === 1 ? '' : 's'}, ${stats.messagesUpserted} message${stats.messagesUpserted === 1 ? '' : 's'}, ${stats.contactsUpserted} contact${stats.contactsUpserted === 1 ? '' : 's'}`,
        at: now(),
      })
      // Wipe the cached SSR pages so the user sees the new data on /chats
      // and /contacts without a hard reload.
      revalidatePath('/chats')
      revalidatePath('/contacts')
      revalidatePath('/companies')
      revalidatePath('/')
    } catch (err) {
      // Don't fail the whole run if DB write fails — the user still has the
      // in-memory results to inspect via the artifacts.
      const msg = err instanceof Error ? err.message : String(err)
      persistLogs.push({
        level: 'error',
        message: `DB save failed: ${msg}`,
        at: now(),
      })
    }

    return {
      status: 'success',
      ranAt: now(),
      logs: [...allLogs, ...persistLogs],
      summary,
      artifacts: result.artifacts,
      isMock: false,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err)
    return {
      status: 'error',
      error: `Scraper threw: ${msg}`,
      logs: [...preLogs, { level: 'error', message: msg, at: now() }],
      artifacts: [],
      isMock: false,
    }
  }
}

function errorResult(message: string, now: () => string): ScrapeResult {
  return {
    status: 'error',
    error: message,
    logs: [{ level: 'error', message, at: now() }],
    artifacts: [],
    isMock: false,
  }
}

export async function createCompany(
  _prev: CreateCompanyState,
  formData: FormData,
): Promise<CreateCompanyState> {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) {
    return { status: 'error', message: 'Company name is required.' }
  }

  // Slug must be safe for filenames (storage state path) and URL params.
  // Lowercase, dashes, no leading/trailing dashes.
  const rawSlug = String(formData.get('slug') ?? '').trim() || name
  const slug = rawSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) {
    return {
      status: 'error',
      message: 'Slug must contain at least one alphanumeric character.',
    }
  }

  ensureMigrated()
  const repo = createCompaniesRepository(getDb())
  if (repo.findBySlug(slug)) {
    return { status: 'error', message: `Slug "${slug}" is already in use.` }
  }

  const company = repo.create({ name, slug })

  // First company created becomes the active scope automatically — without
  // this, the user would have to go pick from a switcher with one option.
  const { companyId: existing } = await readScopeCookies()
  if (!existing) {
    await writeScopeCookies({ companyId: company.id, service: 'taptalk' })
  }

  revalidatePath('/companies')
  revalidatePath('/')
  return { status: 'success', companyId: company.id, message: `Created ${company.name}.` }
}

// Typed-confirm delete is enforced client-side; this server action takes
// the id and a `confirm` field that must equal the company slug. Cheap
// belt-and-suspenders against double-click misclicks.
export async function deleteCompany(formData: FormData): Promise<void> {
  const id = Number(formData.get('id'))
  const confirm = String(formData.get('confirm') ?? '').trim()
  if (!Number.isInteger(id) || id <= 0) return

  ensureMigrated()
  const repo = createCompaniesRepository(getDb())
  const company = repo.findById(id)
  if (!company) return
  if (confirm && confirm !== company.slug) return

  repo.delete(id)

  // If the deleted company was the active scope, clear the cookie so the
  // next page render picks a fresh default instead of 404-ing.
  const { companyId: active } = await readScopeCookies()
  if (active === id) await clearScopeCookies()

  revalidatePath('/companies')
  revalidatePath('/')
  revalidatePath('/chats')
  revalidatePath('/contacts')
}

// Cookie writers driven by the global ScopeSwitcher / ThemeToggle. Returning
// void keeps these usable as `<form action={…}>` targets directly.
export async function setScope(formData: FormData): Promise<void> {
  const companyId = Number(formData.get('companyId'))
  const serviceRaw = String(formData.get('service') ?? '')
  if (!Number.isInteger(companyId) || companyId <= 0) return
  if (!isService(serviceRaw)) return

  ensureMigrated()
  if (!createCompaniesRepository(getDb()).findById(companyId)) return

  await writeScopeCookies({ companyId, service: serviceRaw })

  // Every scoped page is server-rendered — invalidate so they pick up the
  // new cookie immediately instead of waiting for a soft navigation.
  revalidatePath('/', 'layout')
}

export async function setTheme(formData: FormData): Promise<void> {
  const v = String(formData.get('theme') ?? '')
  const theme: ThemePreference =
    v === 'light' || v === 'dark' ? v : 'system'
  await writeThemeCookie(theme)
  revalidatePath('/', 'layout')
}
