import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// A tenant. Every chat/contact/message belongs to exactly one company so the
// same OneTalk inbox (or future WhatsApp / etc. inbox) for two different
// customers can coexist in one DB.
export const companies = sqliteTable('companies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Stable short identifier used in storage paths (e.g. .data/storage/<slug>-<service>.json).
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

// Which scraping mechanism produced the row. Add new entries here as new
// adapters are implemented (e.g. 'whatsapp', 'instagram', …).
export const SERVICES = ['taptalk', 'whatsapp'] as const
export type Service = (typeof SERVICES)[number]

// One row per distinct (company, service, phone). The same phone number can
// legitimately exist under two companies, or under the same company through
// two different services, so the natural key is the triplet — not phone alone.
export const contacts = sqliteTable(
  'contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    service: text('service').notNull(),
    phone: text('phone').notNull(),
    displayName: text('display_name'),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex('contacts_scope_phone_unique').on(t.companyId, t.service, t.phone),
    index('contacts_company_service_idx').on(t.companyId, t.service),
  ],
)

// Surrogate integer PK (was: source's natural id as text). Switching to a
// surrogate means the same TapTalk case id can appear under two companies
// without colliding, and gives us a single integer FK target for messages.
// `externalId` preserves the source's natural id for display + idempotent
// upsert via the (company, service, externalId) unique index.
export const chats = sqliteTable(
  'chats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    service: text('service').notNull(),
    externalId: text('external_id').notNull(),
    contactId: integer('contact_id').references(() => contacts.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    contactPhoneRaw: text('contact_phone_raw'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    firstResponseAt: integer('first_response_at', { mode: 'timestamp_ms' }),
    firstResponseWait: text('first_response_wait'),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    caseDuration: text('case_duration'),
    firstMessage: text('first_message'),
    scrapedAt: integer('scraped_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex('chats_scope_external_id_unique').on(
      t.companyId,
      t.service,
      t.externalId,
    ),
    index('chats_contact_id_idx').on(t.contactId),
    index('chats_created_at_idx').on(t.createdAt),
    index('chats_company_service_idx').on(t.companyId, t.service),
  ],
)

// Messages key on (chatId, messageId). Re-scraping a chat replaces all its
// messages rather than diffing — message ids from the scraper can shift when
// the source DOM changes, and we don't annotate messages locally.
export const messages = sqliteTable(
  'messages',
  {
    chatId: integer('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    seq: integer('seq').notNull(),
    direction: text('direction', { enum: ['in', 'out', 'info'] }).notNull(),
    senderName: text('sender_name'),
    isAgent: integer('is_agent', { mode: 'boolean' }),
    body: text('body'),
    imageUrl: text('image_url'),
    fileName: text('file_name'),
    caption: text('caption'),
    replyToName: text('reply_to_name'),
    replyToText: text('reply_to_text'),
    timestampLabel: text('timestamp_label'),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.messageId] })],
)

export type Company = typeof companies.$inferSelect
export type NewCompany = typeof companies.$inferInsert
export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
