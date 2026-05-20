import type {
  ChatMessage,
  ChatRow,
  ScrapeLog,
  ScrapeLogLevel,
} from '../../../app/scrape-types'
import type { ScrapeContext, ScrapeOutput } from '../types'
import {
  deviceStatus,
  getChatMessages,
  listChats,
  type ChatListItem,
  type ChatMessageItem,
} from '../../whatsapp/client'
import { readSession } from './session'

export type WhatsappInput = {
  maxChats: number
  dateFrom?: string // YYYY-MM-DD
  dateTo?: string // YYYY-MM-DD
}

const PAGE_SIZE = 100 // service caps at 100 per the OpenAPI

// Convert "YYYY-MM-DD" → ISO at midnight UTC for the API's start_time/end_time.
function dateToIso(date: string | undefined, endOfDay = false): string | undefined {
  if (!date) return undefined
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return undefined
  const dt = new Date(Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0))
  return dt.toISOString()
}

// JID local part — what we store as the contact's "phone". For groups the JID
// is `<random>@g.us` so this is the group id, not a real number; that's fine,
// the contacts table is keyed on (company, service, phone) so groups won't
// collide with real numbers from other services.
function jidLocalPart(jid: string): string {
  const at = jid.indexOf('@')
  return at === -1 ? jid : jid.slice(0, at)
}

function mapDirection(m: ChatMessageItem): 'in' | 'out' | 'info' {
  if (m.is_from_me) return 'out'
  // Calls and other system records arrive without a sender_jid in this version
  // of the spec — treat them as info so the chat view can render them apart
  // from real inbound/outbound messages.
  if (!m.sender_jid) return 'info'
  return 'in'
}

function mapMessage(m: ChatMessageItem): ChatMessage {
  return {
    id: m.id,
    direction: mapDirection(m),
    // The spec doesn't expose a friendly sender name on the message, only the
    // JID. Local part is the best we can do without a separate /user/info call.
    senderName: m.sender_jid ? jidLocalPart(m.sender_jid) : undefined,
    body: m.content,
    imageUrl: m.media_type?.startsWith('image') ? m.url ?? undefined : undefined,
    fileName: m.filename ?? undefined,
    timestamp: m.timestamp,
  }
}

export async function scrapeChatList(
  input: WhatsappInput,
  ctx: ScrapeContext,
): Promise<ScrapeOutput> {
  const logs: ScrapeLog[] = []
  const log = (level: ScrapeLogLevel, message: string) => {
    logs.push({ level, message, at: new Date().toISOString() })
  }

  const session = readSession(ctx)
  if (!session) {
    throw new Error('WhatsApp device not paired for this company. Pair it from the dashboard.')
  }
  const deviceId = session.deviceId

  // Confirm the device is actually connected + logged in before we burn time
  // paginating chats only to fail per-request.
  const status = await deviceStatus(deviceId)
  if (!status.is_logged_in) {
    throw new Error(
      `WhatsApp device "${deviceId}" is not logged in (connected=${status.is_connected}). Re-pair from the dashboard.`,
    )
  }
  log('info', `Device ${deviceId} online · user ${status.device_id ?? 'unknown'}`)

  const startTime = dateToIso(input.dateFrom, false)
  const endTime = dateToIso(input.dateTo ?? input.dateFrom, true)

  // 1. Paginate /chats until exhausted or maxChats reached.
  const chats: ChatListItem[] = []
  let offset = 0
  while (chats.length < input.maxChats) {
    const remaining = input.maxChats - chats.length
    const limit = Math.min(PAGE_SIZE, remaining)
    const page = await listChats(deviceId, { limit, offset })
    const rows = page.data ?? []
    if (rows.length === 0) break
    chats.push(...rows)
    log('info', `Fetched ${chats.length}/${input.maxChats} chats (offset=${offset})`)
    if (rows.length < limit) break
    offset += rows.length
  }
  log('info', `Total chats fetched: ${chats.length}`)

  // 2. For each chat, fetch its messages within the date window. We page
  //    until exhausted — no per-chat cap; users who need one can tighten
  //    the date window.
  const out: ChatRow[] = []
  for (const c of chats) {
    const jid = c.jid
    const allMessages: ChatMessageItem[] = []
    let mOffset = 0
    while (true) {
      const page = await getChatMessages(deviceId, jid, {
        limit: PAGE_SIZE,
        offset: mOffset,
        start_time: startTime,
        end_time: endTime,
      })
      const rows = page.data ?? []
      if (rows.length === 0) break
      allMessages.push(...rows)
      if (rows.length < PAGE_SIZE) break
      mOffset += rows.length
    }

    // Sort ascending by timestamp so `firstMessage` and createdAt below
    // reflect the chronological start of the conversation.
    allMessages.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
    const mapped = allMessages.map(mapMessage)
    const firstInbound = mapped.find((m) => m.direction === 'in' && m.body)
    const earliest = allMessages[0]?.timestamp

    out.push({
      id: jid,
      name: c.name?.trim() || jidLocalPart(jid),
      // ChatRow.createdAt is required by the type; fall back to "now" when
      // the chat has no messages in the window so we still upsert the row.
      createdAt: earliest ?? new Date().toISOString(),
      contactPhone: jidLocalPart(jid),
      firstMessage: firstInbound?.body,
      messages: mapped,
    })
  }
  log('info', `Total messages fetched: ${out.reduce((acc, r) => acc + (r.messages?.length ?? 0), 0)}`)

  return { chats: out, logs, artifacts: [] }
}
