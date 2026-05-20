import { and, asc, count, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { chats, contacts, messages } from '../schema'
import type { DbLike, Scope } from './types'

export type UpsertChatInput = {
  externalId: string
  contactId: number | null
  name: string
  contactPhoneRaw: string | null
  createdAt: Date | null
  firstResponseAt: Date | null
  firstResponseWait: string | null
  resolvedAt: Date | null
  caseDuration: string | null
  firstMessage: string | null
}

export type ListChatsInput = {
  page: number // 1-based
  pageSize: number
  search?: string // matches chat name, phone, or first message
  sort?: 'newest' | 'oldest' | 'recently_saved'
}

export type ChatListRow = {
  id: number
  externalId: string
  name: string
  contactPhoneRaw: string | null
  contactId: number | null
  contactPhone: string | null
  contactDisplayName: string | null
  createdAt: Date | null
  firstResponseAt: Date | null
  resolvedAt: Date | null
  caseDuration: string | null
  firstMessage: string | null
  scrapedAt: Date
  updatedAt: Date
  messageCount: number
}

export type ChatDetailRow = ChatListRow & {
  firstResponseWait: string | null
}

// Correlated subquery counting messages for the current chat row. Returned
// as a fresh fragment each call so callers can `.as(...)` it without two
// queries fighting over the same identifier.
function messageCountSubquery() {
  return sql<number>`(SELECT COUNT(*) FROM ${messages} WHERE ${messages.chatId} = ${chats.id})`
}

// Common SELECT shape used by every list / find query in this file. Keeping
// it here means a new column on `chats` only needs to be added in one place.
function chatListSelect() {
  return {
    id: chats.id,
    externalId: chats.externalId,
    name: chats.name,
    contactPhoneRaw: chats.contactPhoneRaw,
    contactId: chats.contactId,
    contactPhone: contacts.phone,
    contactDisplayName: contacts.displayName,
    createdAt: chats.createdAt,
    firstResponseAt: chats.firstResponseAt,
    resolvedAt: chats.resolvedAt,
    caseDuration: chats.caseDuration,
    firstMessage: chats.firstMessage,
    scrapedAt: chats.scrapedAt,
    updatedAt: chats.updatedAt,
    messageCount: messageCountSubquery().as('message_count'),
  }
}

function chatDetailSelect() {
  return { ...chatListSelect(), firstResponseWait: chats.firstResponseWait }
}

function chatScopeWhere(scope: Scope) {
  return and(
    eq(chats.companyId, scope.companyId),
    eq(chats.service, scope.service),
  )
}

function buildChatWhere(scope: Scope, input: Pick<ListChatsInput, 'search'>) {
  const parts = [chatScopeWhere(scope)]
  if (input.search && input.search.trim()) {
    const needle = `%${input.search.trim()}%`
    const searchOr = or(
      like(chats.name, needle),
      like(chats.contactPhoneRaw, needle),
      like(chats.firstMessage, needle),
      like(contacts.phone, needle),
      like(contacts.displayName, needle),
    )
    if (searchOr) parts.push(searchOr)
  }
  return parts.length === 1 ? parts[0] : and(...parts)
}

export function createChatsRepository(db: DbLike) {
  return {
    list(
      scope: Scope,
      input: ListChatsInput,
    ): { rows: ChatListRow[]; total: number } {
      const page = Math.max(1, Math.floor(input.page))
      const pageSize = Math.max(1, Math.min(200, Math.floor(input.pageSize)))
      const offset = (page - 1) * pageSize

      const where = buildChatWhere(scope, input)

      const totalRow = db
        .select({ total: count() })
        .from(chats)
        .leftJoin(contacts, eq(chats.contactId, contacts.id))
        .where(where)
        .get()

      const orderBy = (() => {
        switch (input.sort) {
          case 'oldest':
            return asc(chats.createdAt)
          case 'recently_saved':
            return desc(chats.updatedAt)
          case 'newest':
          default:
            return desc(chats.createdAt)
        }
      })()

      const rows = db
        .select(chatListSelect())
        .from(chats)
        .leftJoin(contacts, eq(chats.contactId, contacts.id))
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset)
        .all()

      return { rows, total: totalRow?.total ?? 0 }
    },

    // Used by exports — pulls every chat for a set of contacts in one query.
    // Returns [] for empty input so callers don't have to special-case. No
    // additional scope filter: the contactIds came from a scoped contact
    // query so chats joined to them inherit the scope.
    listForContacts(contactIds: number[]): ChatListRow[] {
      if (contactIds.length === 0) return []
      return db
        .select(chatListSelect())
        .from(chats)
        .leftJoin(contacts, eq(chats.contactId, contacts.id))
        .where(inArray(chats.contactId, contactIds))
        .orderBy(asc(chats.contactId), asc(chats.createdAt))
        .all()
    },

    // Same shape as listForContacts but also pulls firstResponseWait, used
    // when an export needs the per-chat detail row.
    listDetailedForContacts(contactIds: number[]): ChatDetailRow[] {
      if (contactIds.length === 0) return []
      return db
        .select(chatDetailSelect())
        .from(chats)
        .leftJoin(contacts, eq(chats.contactId, contacts.id))
        .where(inArray(chats.contactId, contactIds))
        .orderBy(asc(chats.contactId), asc(chats.createdAt))
        .all()
    },

    listForContact(contactId: number): ChatListRow[] {
      return db
        .select(chatListSelect())
        .from(chats)
        .leftJoin(contacts, eq(chats.contactId, contacts.id))
        .where(eq(chats.contactId, contactId))
        .orderBy(asc(chats.createdAt))
        .all()
    },

    // Looks up by surrogate integer id. Scope is enforced so a chat from
    // one company can't be opened by guessing the URL while a different
    // company is active.
    findById(scope: Scope, id: number): ChatDetailRow | undefined {
      return db
        .select(chatDetailSelect())
        .from(chats)
        .leftJoin(contacts, eq(chats.contactId, contacts.id))
        .where(and(chatScopeWhere(scope), eq(chats.id, id)))
        .get()
    },

    // Idempotent insert keyed on (companyId, service, externalId). Returns
    // the surrogate id so callers can wire messages.chatId without a
    // second round trip.
    upsert(scope: Scope, input: UpsertChatInput): number {
      const now = new Date()
      const [row] = db
        .insert(chats)
        .values({
          companyId: scope.companyId,
          service: scope.service,
          externalId: input.externalId,
          contactId: input.contactId,
          name: input.name,
          contactPhoneRaw: input.contactPhoneRaw,
          createdAt: input.createdAt,
          firstResponseAt: input.firstResponseAt,
          firstResponseWait: input.firstResponseWait,
          resolvedAt: input.resolvedAt,
          caseDuration: input.caseDuration,
          firstMessage: input.firstMessage,
          scrapedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [chats.companyId, chats.service, chats.externalId],
          set: {
            contactId: input.contactId,
            name: input.name,
            contactPhoneRaw: input.contactPhoneRaw,
            createdAt: input.createdAt,
            firstResponseAt: input.firstResponseAt,
            firstResponseWait: input.firstResponseWait,
            resolvedAt: input.resolvedAt,
            caseDuration: input.caseDuration,
            firstMessage: input.firstMessage,
            updatedAt: now,
            // scrapedAt intentionally preserved — it's "first seen".
          },
        })
        .returning({ id: chats.id })
        .all()
      return row.id
    },
  }
}
