import { normalizePhone } from '../phone'
import type { ChatRow } from '../../app/scrape-types'
import { ensureMigrated, getDb } from './client'
import { makeRepositories, type Scope } from './repositories'

export type PersistStats = {
  contactsUpserted: number
  chatsUpserted: number
  messagesUpserted: number
}

function parseIso(iso: string | undefined | null): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t)
}

// Persist one scrape's chats + messages, normalizing phones into the contacts
// table. Runs inside a single transaction so a mid-run failure can't leave
// half-written chats behind.
export function persistScrapedChats(
  scope: Scope,
  chatRows: ChatRow[],
): PersistStats {
  ensureMigrated()
  const db = getDb()

  let contactsUpserted = 0
  let chatsUpserted = 0
  let messagesUpserted = 0

  db.transaction((tx) => {
    const repos = makeRepositories(tx)

    for (const chat of chatRows) {
      const phone = normalizePhone(chat.contactPhone)
      let contactId: number | null = null
      if (phone) {
        contactId = repos.contacts.upsertByPhone(scope, {
          phone,
          displayName: chat.name || null,
        })
        contactsUpserted++
      }

      const chatPk = repos.chats.upsert(scope, {
        externalId: chat.id,
        contactId,
        name: chat.name,
        contactPhoneRaw: chat.contactPhone ?? null,
        createdAt: parseIso(chat.createdAt),
        firstResponseAt: parseIso(chat.firstResponseAt),
        firstResponseWait: chat.firstResponseWait ?? null,
        resolvedAt: parseIso(chat.resolvedAt),
        caseDuration: chat.caseDuration ?? null,
        firstMessage: chat.firstMessage ?? null,
      })
      chatsUpserted++

      const msgs = chat.messages ?? []
      repos.messages.replaceForChat(
        chatPk,
        msgs.map((m, idx) => ({
          messageId: m.id,
          seq: idx + 1,
          direction: m.direction,
          senderName: m.senderName ?? null,
          isAgent: m.isAgent ?? null,
          body: m.body ?? null,
          imageUrl: m.imageUrl ?? null,
          fileName: m.fileName ?? null,
          caption: m.caption ?? null,
          replyToName: m.replyToName ?? null,
          replyToText: m.replyToText ?? null,
          timestampLabel: m.timestamp ?? null,
        })),
      )
      messagesUpserted += msgs.length
    }
  })

  return { contactsUpserted, chatsUpserted, messagesUpserted }
}
