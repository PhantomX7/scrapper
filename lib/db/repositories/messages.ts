import { asc, eq, inArray } from 'drizzle-orm'
import { chats, contacts, messages } from '../schema'
import type { DbLike } from './types'

export type UpsertMessageInput = {
  messageId: string
  seq: number
  direction: 'in' | 'out' | 'info'
  senderName: string | null
  isAgent: boolean | null
  body: string | null
  imageUrl: string | null
  fileName: string | null
  caption: string | null
  replyToName: string | null
  replyToText: string | null
  timestampLabel: string | null
}

export function createMessagesRepository(db: DbLike) {
  return {
    listByChat(chatId: number) {
      return db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.seq))
        .all()
    },

    // Batch variant of listForContact for exports: every message across
    // every chat for any of the given contacts, ordered so messages stay
    // grouped by contact then by chat then by seq.
    listForContacts(contactIds: number[]) {
      if (contactIds.length === 0) return []
      return db
        .select({
          contactId: chats.contactId,
          chatId: messages.chatId,
          chatExternalId: chats.externalId,
          messageId: messages.messageId,
          seq: messages.seq,
          direction: messages.direction,
          senderName: messages.senderName,
          isAgent: messages.isAgent,
          body: messages.body,
          imageUrl: messages.imageUrl,
          fileName: messages.fileName,
          caption: messages.caption,
          replyToName: messages.replyToName,
          replyToText: messages.replyToText,
          timestampLabel: messages.timestampLabel,
          chatName: chats.name,
          chatCreatedAt: chats.createdAt,
          contactPhone: contacts.phone,
          contactDisplayName: contacts.displayName,
        })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .leftJoin(contacts, eq(chats.contactId, contacts.id))
        .where(inArray(chats.contactId, contactIds))
        .orderBy(asc(chats.contactId), asc(chats.createdAt), asc(messages.seq))
        .all()
    },

    // Every message across every chat for a single contact, sorted in
    // chronological order (by parent chat's createdAt first, then by
    // intra-chat seq). Chat metadata is joined in so the UI can draw a
    // separator when the chat boundary changes.
    listForContact(contactId: number) {
      return db
        .select({
          chatId: messages.chatId,
          chatExternalId: chats.externalId,
          messageId: messages.messageId,
          seq: messages.seq,
          direction: messages.direction,
          senderName: messages.senderName,
          isAgent: messages.isAgent,
          body: messages.body,
          imageUrl: messages.imageUrl,
          fileName: messages.fileName,
          caption: messages.caption,
          replyToName: messages.replyToName,
          replyToText: messages.replyToText,
          timestampLabel: messages.timestampLabel,
          chatName: chats.name,
          chatCreatedAt: chats.createdAt,
        })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(eq(chats.contactId, contactId))
        .orderBy(asc(chats.createdAt), asc(messages.seq))
        .all()
    },

    // Delete-and-reinsert because the scraper is the source of truth for a
    // chat's message list; re-scraping should produce the latest snapshot
    // even if message ids shifted.
    replaceForChat(chatId: number, inputs: UpsertMessageInput[]): void {
      db.delete(messages).where(eq(messages.chatId, chatId)).run()
      if (inputs.length === 0) return
      db.insert(messages)
        .values(inputs.map((m) => ({ ...m, chatId })))
        .run()
    },
  }
}
