import type { NextRequest } from 'next/server'
import { ensureMigrated, getDb } from '../../../lib/db/client'
import {
  createChatsRepository,
  createContactsRepository,
  createMessagesRepository,
  type ChatDetailRow,
  type ContactAggregateRow,
} from '../../../lib/db/repositories'
import { censorPhone } from '../../../lib/phone'
import { resolveScope } from '../../_lib/scope'
import { parseContactsFilters } from '../_lib/filters'
import { formatDurationMs } from '../_lib/format'

// Always re-run on request — the export is a snapshot of the live DB and must
// reflect whatever filters the user just applied, never a stale build-time copy.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const filters = parseContactsFilters((key) =>
    request.nextUrl.searchParams.get(key) ?? undefined,
  )

  // Scope comes from the cookie set by the global ScopeSwitcher — same
  // resolver every page uses.
  const scope = await resolveScope()
  if (!scope) {
    return new Response('No companies configured.', { status: 400 })
  }

  ensureMigrated()
  const db = getDb()
  const contactsRepo = createContactsRepository(db)
  const chatsRepo = createChatsRepository(db)
  const messagesRepo = createMessagesRepository(db)
  const rows = contactsRepo.listAllAggregated(
    { companyId: scope.company.id, service: scope.service },
    {
      dateFrom: filters.dateFromDate,
      dateTo: filters.dateToDate,
      search: filters.q || undefined,
      sort: filters.sort,
    },
  )
  const contactIds = rows.map((r) => r.contactId)
  const chatRows = chatsRepo.listDetailedForContacts(contactIds)
  const messageRows = messagesRepo.listForContacts(contactIds)

  const buffer = await buildContactsXlsx(rows, chatRows, messageRows, {
    company: scope.company.name,
    service: scope.service,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    q: filters.q,
    sort: filters.sort,
    keywords: filters.keywords,
  })

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${scope.company.slug}-${scope.service}-contacts-${stampForFilename()}.xlsx"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}

type MessageExportRow = ReturnType<
  ReturnType<typeof createMessagesRepository>['listForContacts']
>[number]

async function buildContactsXlsx(
  rows: ContactAggregateRow[],
  chatRows: ChatDetailRow[],
  messageRows: MessageExportRow[],
  filters: {
    company: string
    service: string
    dateFrom: string
    dateTo: string
    q: string
    sort: string
    keywords: string[]
  },
): Promise<ArrayBuffer> {
  // Per-contact and per-chat keyword hits. Built once over the full message
  // set so the row-write loops below stay O(1) per row. Both maps are empty
  // when the user didn't enter any keywords — the columns are then omitted.
  const { contactHits, chatHits } = computeKeywordHits(
    messageRows,
    filters.keywords,
  )
  const hasKeywords = filters.keywords.length > 0
  // Dynamic import keeps exceljs out of any other route's bundle.
  const { default: ExcelJS } = await import('exceljs')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'taptalk-scrap'
  wb.created = new Date()

  const ws = wb.addWorksheet('Contacts', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  ws.columns = [
    { header: 'Contact', key: 'name', width: 32 },
    { header: 'Phone', key: 'phone', width: 22 },
    { header: 'Chats', key: 'chatCount', width: 10 },
    { header: 'Messages', key: 'messageCount', width: 12 },
    { header: 'First chat', key: 'firstChatAt', width: 22 },
    { header: 'First reply', key: 'firstReplyAt', width: 22 },
    // Two columns: human-readable string for at-a-glance reading, plus the
    // raw seconds so the file can be sorted/averaged in Excel without parsing.
    { header: 'Avg first response', key: 'avgFirstResponse', width: 18 },
    { header: 'Avg first response (s)', key: 'avgFirstResponseSec', width: 22 },
    // Working-hour variant: counts only the portion of each wait that falls
    // inside 9 AM – 5 PM GMT+7. Off-hours stretches don't accumulate.
    { header: 'Avg WH reply', key: 'avgWorkingHourReply', width: 18 },
    { header: 'Avg WH reply (s)', key: 'avgWorkingHourReplySec', width: 22 },
    { header: 'Last chat', key: 'lastChatAt', width: 22 },
    // Keyword-driven transaction classification. Columns are added only when
    // the user supplied keywords — keeps the default export shape unchanged.
    ...(hasKeywords
      ? [
          { header: 'Has transaction', key: 'hasTransaction', width: 16 },
          { header: 'Matched keywords', key: 'matchedKeywords', width: 32 },
        ]
      : []),
  ]

  ws.getRow(1).font = { bold: true }
  ws.getRow(1).alignment = { vertical: 'middle' }

  for (const key of ['firstChatAt', 'firstReplyAt', 'lastChatAt']) {
    ws.getColumn(key).numFmt = 'yyyy-mm-dd hh:mm:ss'
  }
  for (const key of [
    'chatCount',
    'messageCount',
    'avgFirstResponseSec',
    'avgWorkingHourReplySec',
  ]) {
    ws.getColumn(key).alignment = { horizontal: 'right' }
  }
  ws.getColumn('avgFirstResponseSec').numFmt = '0'
  ws.getColumn('avgWorkingHourReplySec').numFmt = '0'

  for (const r of rows) {
    const hits = contactHits.get(r.contactId)
    ws.addRow({
      name: r.displayName ?? '',
      phone: censorPhone(r.phone),
      chatCount: r.chatCount,
      messageCount: r.messageCount,
      firstChatAt: r.firstChatAt ?? null,
      firstReplyAt: r.firstReplyAt ?? null,
      avgFirstResponse:
        r.avgFirstResponseMs == null ? '' : formatDurationMs(r.avgFirstResponseMs),
      avgFirstResponseSec:
        r.avgFirstResponseMs == null ? null : Math.round(r.avgFirstResponseMs / 1000),
      avgWorkingHourReply:
        r.avgWorkingHourReplyMs == null
          ? ''
          : formatDurationMs(r.avgWorkingHourReplyMs),
      avgWorkingHourReplySec:
        r.avgWorkingHourReplyMs == null
          ? null
          : Math.round(r.avgWorkingHourReplyMs / 1000),
      lastChatAt: r.lastChatAt ?? null,
      ...(hasKeywords
        ? {
            hasTransaction: hits && hits.size > 0 ? 'Yes' : 'No',
            matchedKeywords: hits ? [...hits].join(', ') : '',
          }
        : {}),
    })
  }

  // Per-chat detail for every chat belonging to the filtered contacts. Linked
  // back to the Contacts sheet by Phone (and to chats themselves by Chat ID).
  const chatsWs = wb.addWorksheet('Chats', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  chatsWs.columns = [
    { header: 'Contact', key: 'contactName', width: 30 },
    { header: 'Phone', key: 'phone', width: 22 },
    { header: 'Chat ID', key: 'id', width: 10 },
    { header: 'External ID', key: 'externalId', width: 16 },
    { header: 'Chat name', key: 'name', width: 30 },
    { header: 'Created', key: 'createdAt', width: 22 },
    { header: 'First reply', key: 'firstResponseAt', width: 22 },
    { header: 'First reply wait', key: 'firstResponseWait', width: 18 },
    { header: 'Resolved', key: 'resolvedAt', width: 22 },
    { header: 'Case duration', key: 'caseDuration', width: 18 },
    { header: 'Messages', key: 'messageCount', width: 12 },
    { header: 'First message', key: 'firstMessage', width: 60 },
    ...(hasKeywords
      ? [
          { header: 'Has transaction', key: 'hasTransaction', width: 16 },
          { header: 'Matched keywords', key: 'matchedKeywords', width: 32 },
        ]
      : []),
  ]
  chatsWs.getRow(1).font = { bold: true }
  chatsWs.getRow(1).alignment = { vertical: 'middle' }
  for (const key of ['createdAt', 'firstResponseAt', 'resolvedAt']) {
    chatsWs.getColumn(key).numFmt = 'yyyy-mm-dd hh:mm:ss'
  }
  chatsWs.getColumn('messageCount').alignment = { horizontal: 'right' }
  chatsWs.getColumn('firstMessage').alignment = { wrapText: true, vertical: 'top' }

  for (const c of chatRows) {
    const hits = chatHits.get(c.id)
    chatsWs.addRow({
      contactName: c.contactDisplayName ?? '',
      phone: censorPhone(c.contactPhone ?? c.contactPhoneRaw),
      id: c.id,
      externalId: c.externalId,
      name: c.name,
      createdAt: c.createdAt ?? null,
      firstResponseAt: c.firstResponseAt ?? null,
      firstResponseWait: c.firstResponseWait ?? '',
      resolvedAt: c.resolvedAt ?? null,
      caseDuration: c.caseDuration ?? '',
      messageCount: c.messageCount,
      firstMessage: c.firstMessage ?? '',
      ...(hasKeywords
        ? {
            hasTransaction: hits && hits.size > 0 ? 'Yes' : 'No',
            matchedKeywords: hits ? [...hits].join(', ') : '',
          }
        : {}),
    })
  }

  // Every message across every chat for the filtered contacts. Joinable to
  // the Chats sheet via Chat ID so the file can be filtered/pivoted in Excel.
  const msgsWs = wb.addWorksheet('Messages', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  msgsWs.columns = [
    { header: 'Contact', key: 'contactName', width: 30 },
    { header: 'Phone', key: 'phone', width: 22 },
    { header: 'Chat ID', key: 'chatId', width: 10 },
    { header: 'External ID', key: 'chatExternalId', width: 16 },
    { header: 'Chat name', key: 'chatName', width: 30 },
    { header: 'Chat created', key: 'chatCreatedAt', width: 22 },
    { header: 'Seq', key: 'seq', width: 6 },
    { header: 'Direction', key: 'direction', width: 10 },
    { header: 'Sender', key: 'sender', width: 24 },
    { header: 'Is agent', key: 'isAgent', width: 10 },
    { header: 'Timestamp', key: 'timestamp', width: 20 },
    { header: 'Body', key: 'body', width: 60 },
    { header: 'Caption', key: 'caption', width: 40 },
    { header: 'Image URL', key: 'imageUrl', width: 50 },
    { header: 'File name', key: 'fileName', width: 30 },
    { header: 'Reply to sender', key: 'replyToName', width: 24 },
    { header: 'Reply to text', key: 'replyToText', width: 40 },
  ]
  msgsWs.getRow(1).font = { bold: true }
  msgsWs.getRow(1).alignment = { vertical: 'middle' }
  msgsWs.getColumn('chatCreatedAt').numFmt = 'yyyy-mm-dd hh:mm:ss'
  msgsWs.getColumn('seq').alignment = { horizontal: 'right' }
  for (const key of ['body', 'caption', 'replyToText']) {
    msgsWs.getColumn(key).alignment = { wrapText: true, vertical: 'top' }
  }

  for (const m of messageRows) {
    msgsWs.addRow({
      contactName: m.contactDisplayName ?? '',
      phone: censorPhone(m.contactPhone),
      chatId: m.chatId,
      chatExternalId: m.chatExternalId,
      chatName: m.chatName,
      chatCreatedAt: m.chatCreatedAt ?? null,
      seq: m.seq,
      direction: m.direction,
      sender: m.senderName ?? '',
      isAgent: m.isAgent ? 'Yes' : '',
      timestamp: m.timestampLabel ?? '',
      body: m.body ?? '',
      caption: m.caption ?? '',
      imageUrl: m.imageUrl ?? '',
      fileName: m.fileName ?? '',
      replyToName: m.replyToName ?? '',
      replyToText: m.replyToText ?? '',
    })
  }

  // Last sheet records the filters used so the export is self-describing
  // weeks later when nobody remembers what was on screen at the time.
  const meta = wb.addWorksheet('Filters')
  meta.columns = [
    { header: 'Field', key: 'k', width: 20 },
    { header: 'Value', key: 'v', width: 60 },
  ]
  meta.getRow(1).font = { bold: true }
  meta.addRows([
    { k: 'Exported at', v: new Date().toISOString() },
    { k: 'Company', v: filters.company },
    { k: 'Service', v: filters.service },
    { k: 'Date from', v: filters.dateFrom || '(unset)' },
    { k: 'Date to', v: filters.dateTo || '(unset)' },
    { k: 'Search', v: filters.q || '(none)' },
    { k: 'Sort', v: filters.sort },
    { k: 'Transaction keywords', v: filters.keywords.join(', ') || '(none)' },
    { k: 'Contacts', v: String(rows.length) },
    { k: 'Chats', v: String(chatRows.length) },
    { k: 'Messages', v: String(messageRows.length) },
  ])

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

// Walks every message once and records, for each contact and each chat, the
// set of keywords found anywhere in its body or caption. Comparison is done
// lowercase so "Payment", "PAYMENT" and "payment" all match the same keyword.
// Returns empty maps when no keywords were supplied — callers should also
// skip rendering the columns in that case.
function computeKeywordHits(
  messageRows: MessageExportRow[],
  keywords: string[],
): { contactHits: Map<number, Set<string>>; chatHits: Map<number, Set<string>> } {
  const contactHits = new Map<number, Set<string>>()
  const chatHits = new Map<number, Set<string>>()
  if (keywords.length === 0) return { contactHits, chatHits }

  const needles = keywords.map((k) => ({ original: k, lower: k.toLowerCase() }))

  for (const m of messageRows) {
    const haystack = `${m.body ?? ''}\n${m.caption ?? ''}`.toLowerCase()
    if (!haystack.trim()) continue
    for (const n of needles) {
      if (!haystack.includes(n.lower)) continue
      // contactId comes from the chats join — null only if the chat was
      // orphaned, which the listForContacts query filters out anyway.
      if (m.contactId != null) {
        let set = contactHits.get(m.contactId)
        if (!set) {
          set = new Set()
          contactHits.set(m.contactId, set)
        }
        set.add(n.original)
      }
      let chatSet = chatHits.get(m.chatId)
      if (!chatSet) {
        chatSet = new Set()
        chatHits.set(m.chatId, chatSet)
      }
      chatSet.add(n.original)
    }
  }

  return { contactHits, chatHits }
}

function stampForFilename(d: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
