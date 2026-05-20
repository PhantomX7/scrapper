import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  like,
  max,
  min,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { workingHourOverlapMs } from '../../working-hours'
import { chats, contacts, messages } from '../schema'
import type { DbLike, Scope } from './types'

export type UpsertContactInput = {
  phone: string // normalized (digits only)
  displayName?: string | null
}

export type ContactsSort =
  | 'first_chat_desc'
  | 'most_chats'
  | 'most_messages'
  | 'recent'
  | 'oldest'
  | 'name'

export type ListContactsInput = {
  page: number // 1-based
  pageSize: number
  // The date range filters by the contact's *first ever* chat: a contact
  // appears only if MIN(chats.createdAt) falls inside the window.
  // Aggregates (chat count, message count, last chat) are all-time for that
  // contact — once a contact qualifies, you see their full footprint.
  dateFrom?: Date | null
  dateTo?: Date | null
  search?: string
  sort?: ContactsSort
}

export type ListAllContactsInput = Omit<ListContactsInput, 'page' | 'pageSize'>

export type ContactAggregateRow = {
  contactId: number
  phone: string
  displayName: string | null
  chatCount: number
  messageCount: number
  firstChatAt: Date | null
  lastChatAt: Date | null
  // Earliest agent first-response across all of this contact's chats in the
  // window. Null when no chat has had an agent reply yet.
  firstReplyAt: Date | null
  // Average wait between chat creation and first agent reply, in ms,
  // across all chats for this contact that have both timestamps.
  // Null if none qualify.
  avgFirstResponseMs: number | null
  // Working-hour reply average per contact. Per-chat reply time counts
  // only the portion of the wait that overlaps any 9 AM – 5 PM GMT+7
  // window — off-hours stretches don't accumulate. Computed in JS via
  // workingHourOverlapMs. Null when no chat has both timestamps.
  avgWorkingHourReplyMs: number | null
}

// --- shared SQL fragments / helpers ---------------------------------------
//
// All the listAggregated / listAllAggregated machinery sits here so the two
// public methods are thin wrappers — only the parts that differ (paginate +
// totals vs. fetch-everything) live in the methods themselves.

function scopeWhere(scope: Scope) {
  return and(
    eq(contacts.companyId, scope.companyId),
    eq(contacts.service, scope.service),
  )
}

function searchWhere(search: string | undefined): SQL | undefined {
  if (!search?.trim()) return undefined
  const needle = `%${search.trim()}%`
  return or(
    like(contacts.phone, needle),
    like(contacts.displayName, needle),
    like(chats.name, needle),
    like(chats.contactPhoneRaw, needle),
  )
}

function combinedWhere(scope: Scope, search: string | undefined) {
  const parts: SQL[] = []
  const sw = scopeWhere(scope)
  if (sw) parts.push(sw)
  const search_ = searchWhere(search)
  if (search_) parts.push(search_)
  if (parts.length === 0) return undefined
  return parts.length === 1 ? parts[0] : and(...parts)
}

// HAVING clause built from the date range. Stored timestamps are ms — we
// compare with .getTime() so we don't depend on drizzle inferring Date
// from the aggregate.
function dateHaving(
  dateFrom: Date | null | undefined,
  dateTo: Date | null | undefined,
): SQL | undefined {
  const parts: SQL[] = []
  if (dateFrom) parts.push(sql`MIN(${chats.createdAt}) >= ${dateFrom.getTime()}`)
  if (dateTo) parts.push(sql`MIN(${chats.createdAt}) <= ${dateTo.getTime()}`)
  if (parts.length === 0) return undefined
  return parts.length === 1 ? parts[0] : and(...parts)
}

// All-time per-contact message count (within scope): once a contact
// passes the first-chat filter, we want their full message footprint.
const messageCountForContactSql = sql<number>`(
  SELECT COUNT(*) FROM ${messages} m
  INNER JOIN ${chats} ch ON m.chat_id = ch.id
  WHERE ch.contact_id = ${contacts.id}
)`

// Average first-response wait per contact, in ms. NULLs in either
// timestamp drop the chat from the AVG, so contacts whose chats all
// lack a reply yield NULL — matching firstReplyAt's semantics.
const avgFirstResponseMsSql = sql<number | null>`AVG(CASE
  WHEN ${chats.firstResponseAt} IS NOT NULL AND ${chats.createdAt} IS NOT NULL
  THEN ${chats.firstResponseAt} - ${chats.createdAt}
END)`

function aggregateOrderBy(sort: ContactsSort | undefined) {
  switch (sort) {
    case 'most_chats':
      return desc(countDistinct(chats.id))
    case 'most_messages':
      return desc(messageCountForContactSql)
    case 'recent':
      return desc(max(chats.createdAt))
    case 'oldest':
      return asc(min(chats.createdAt))
    case 'name':
      return asc(contacts.displayName)
    case 'first_chat_desc':
    default:
      return desc(min(chats.createdAt))
  }
}

const aggregateSelect = {
  contactId: contacts.id,
  phone: contacts.phone,
  displayName: contacts.displayName,
  chatCount: countDistinct(chats.id),
  messageCount: messageCountForContactSql,
  firstChatAt: min(chats.createdAt),
  lastChatAt: max(chats.createdAt),
  firstReplyAt: min(chats.firstResponseAt),
  avgFirstResponseMs: avgFirstResponseMsSql,
}

type RawAggregateRow = {
  contactId: number
  phone: string
  displayName: string | null
  chatCount: number | null
  messageCount: number | null
  firstChatAt: Date | null
  lastChatAt: Date | null
  firstReplyAt: Date | null
  avgFirstResponseMs: number | null
}

function toAggregateRow(
  r: RawAggregateRow,
  whAverages: Map<number, number>,
): ContactAggregateRow {
  return {
    contactId: r.contactId,
    phone: r.phone,
    displayName: r.displayName,
    chatCount: Number(r.chatCount ?? 0),
    messageCount: Number(r.messageCount ?? 0),
    firstChatAt: r.firstChatAt,
    lastChatAt: r.lastChatAt,
    firstReplyAt: r.firstReplyAt,
    avgFirstResponseMs:
      r.avgFirstResponseMs == null ? null : Number(r.avgFirstResponseMs),
    avgWorkingHourReplyMs: whAverages.get(r.contactId) ?? null,
  }
}

// Loads (contactId, createdAt, firstResponseAt) for the given contacts,
// then returns a map of contactId → average working-hour overlap in ms
// across that contact's chats with both timestamps. Mirrors the SQL AVG
// semantics: chats missing either timestamp are excluded from the count,
// so a contact whose chats all lack a reply yields no entry (treated as
// null upstream).
function computeWorkingHourAverages(
  db: DbLike,
  contactIds: number[],
): Map<number, number> {
  if (contactIds.length === 0) return new Map()
  const rows = db
    .select({
      contactId: chats.contactId,
      createdAt: chats.createdAt,
      firstResponseAt: chats.firstResponseAt,
    })
    .from(chats)
    .where(inArray(chats.contactId, contactIds))
    .all()

  const acc = new Map<number, { sum: number; count: number }>()
  for (const r of rows) {
    if (r.contactId == null || !r.createdAt || !r.firstResponseAt) continue
    const ms = workingHourOverlapMs(r.createdAt, r.firstResponseAt)
    const cur = acc.get(r.contactId) ?? { sum: 0, count: 0 }
    cur.sum += ms
    cur.count += 1
    acc.set(r.contactId, cur)
  }

  const out = new Map<number, number>()
  for (const [id, { sum, count }] of acc) {
    if (count > 0) out.set(id, sum / count)
  }
  return out
}

// --- repository ----------------------------------------------------------

export function createContactsRepository(db: DbLike) {
  // Internal: the shared base query used by both list flavors. Returns the
  // already-aggregated raw rows, in the right order, scoped + filtered. The
  // two public methods only differ in pagination + how they count totals.
  function selectAggregateRaw(
    scope: Scope,
    input: ListAllContactsInput,
  ): {
    where: SQL | undefined
    having: SQL | undefined
    fetch(opts?: { limit?: number; offset?: number }): RawAggregateRow[]
  } {
    const where = combinedWhere(scope, input.search)
    const having = dateHaving(input.dateFrom, input.dateTo)
    const orderBy = aggregateOrderBy(input.sort)

    return {
      where,
      having,
      fetch(opts) {
        let q = db
          .select(aggregateSelect)
          .from(contacts)
          .innerJoin(chats, eq(chats.contactId, contacts.id))
          .where(where)
          .groupBy(contacts.id)
          .having(having)
          .orderBy(orderBy, asc(contacts.id))
          .$dynamic()
        if (opts?.limit != null) q = q.limit(opts.limit)
        if (opts?.offset != null) q = q.offset(opts.offset)
        return q.all()
      },
    }
  }

  return {
    // Returns one row per contact whose chats overlap the requested
    // window. Message totals and chat counts are aggregated over the same
    // window so the table stays coherent — no "contact has 0 chats but 40
    // messages".
    listAggregated(
      scope: Scope,
      input: ListContactsInput,
    ): { rows: ContactAggregateRow[]; total: number } {
      const page = Math.max(1, Math.floor(input.page))
      const pageSize = Math.max(1, Math.min(200, Math.floor(input.pageSize)))
      const offset = (page - 1) * pageSize

      const base = selectAggregateRaw(scope, input)
      const rawRows = base.fetch({ limit: pageSize, offset })

      const whAverages = computeWorkingHourAverages(
        db,
        rawRows.map((r) => r.contactId),
      )

      // Count the number of groups (contacts) the filters produce. Wrap the
      // aggregate query in a subquery so COUNT counts groups, not inner rows.
      const countBase = db
        .select({ contactId: contacts.id })
        .from(contacts)
        .innerJoin(chats, eq(chats.contactId, contacts.id))
        .where(base.where)
        .groupBy(contacts.id)
        .having(base.having)
      const totalRow = db
        .select({ total: count() })
        .from(countBase.as('grouped'))
        .get()

      return {
        rows: rawRows.map((r) => toAggregateRow(r, whAverages)),
        total: totalRow?.total ?? 0,
      }
    },

    // Same filters / sort as listAggregated, but unpaginated. Used by the
    // export route — no UI surface needs both flavors at once, so a tiny
    // bit of duplication beats parameterizing the existing method.
    listAllAggregated(
      scope: Scope,
      input: ListAllContactsInput,
    ): ContactAggregateRow[] {
      const rawRows = selectAggregateRaw(scope, input).fetch()
      const whAverages = computeWorkingHourAverages(
        db,
        rawRows.map((r) => r.contactId),
      )
      return rawRows.map((r) => toAggregateRow(r, whAverages))
    },

    upsertByPhone(scope: Scope, input: UpsertContactInput): number {
      const now = new Date()
      const [row] = db
        .insert(contacts)
        .values({
          companyId: scope.companyId,
          service: scope.service,
          phone: input.phone,
          displayName: input.displayName ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          // Conflict target must match the unique index, not just one column.
          target: [contacts.companyId, contacts.service, contacts.phone],
          set: {
            displayName: input.displayName ?? null,
            lastSeenAt: now,
          },
        })
        .returning({ id: contacts.id })
        .all()
      return row.id
    },

    findByPhone(scope: Scope, phone: string) {
      return db
        .select()
        .from(contacts)
        .where(and(scopeWhere(scope), eq(contacts.phone, phone)))
        .get()
    },

    // Looks up a contact by surrogate id, but still scoped — a contact id
    // from one company should not be addressable under another.
    findById(scope: Scope, id: number) {
      return db
        .select()
        .from(contacts)
        .where(and(scopeWhere(scope), eq(contacts.id, id)))
        .get()
    },

    // All-time aggregate for a single contact — not bounded by a date
    // range. Returns null-ish counts if the contact has no chats. The
    // (scope) check is intentionally absent: aggregateForContact is always
    // preceded by a findById that already scoped the contact, and chats
    // inherit scope.
    aggregateForContact(contactId: number): {
      chatCount: number
      messageCount: number
      firstChatAt: Date | null
      lastChatAt: Date | null
    } {
      const messageCountSql = sql<number>`(
        SELECT COUNT(*) FROM ${messages} m
        INNER JOIN ${chats} ch ON m.chat_id = ch.id
        WHERE ch.contact_id = ${contactId}
      )`
      const row = db
        .select({
          chatCount: countDistinct(chats.id),
          messageCount: messageCountSql,
          firstChatAt: min(chats.createdAt),
          lastChatAt: max(chats.createdAt),
        })
        .from(chats)
        .where(eq(chats.contactId, contactId))
        .get()
      return {
        chatCount: Number(row?.chatCount ?? 0),
        messageCount: Number(row?.messageCount ?? 0),
        firstChatAt: row?.firstChatAt ?? null,
        lastChatAt: row?.lastChatAt ?? null,
      }
    },
  }
}
