import { asc, eq, sql } from 'drizzle-orm'
import { chats, companies, contacts, messages, type Service } from '../schema'
import type { DbLike } from './types'

export type CompanyServiceStats = {
  service: Service
  chatCount: number
  contactCount: number
  messageCount: number
  lastScrapedAt: Date | null
}

export type CompanyStats = {
  companyId: number
  // One row per (companyId, service) combination that has at least one
  // chat. Empty array for a brand-new company.
  byService: CompanyServiceStats[]
  totalChats: number
  totalContacts: number
  totalMessages: number
  // Most recent updatedAt across every chat in the company. Null if
  // nothing has ever been scraped under this company.
  lastActivityAt: Date | null
}

export function createCompaniesRepository(db: DbLike) {
  return {
    list() {
      return db
        .select()
        .from(companies)
        .orderBy(asc(companies.name), asc(companies.id))
        .all()
    },

    findById(id: number) {
      return db.select().from(companies).where(eq(companies.id, id)).get()
    },

    findBySlug(slug: string) {
      return db.select().from(companies).where(eq(companies.slug, slug)).get()
    },

    // Returns the inserted row so callers can immediately use the new id
    // (e.g. to set it as the active company).
    create(input: { name: string; slug: string }) {
      const [row] = db
        .insert(companies)
        .values({ name: input.name, slug: input.slug })
        .returning()
        .all()
      return row
    },

    delete(id: number) {
      db.delete(companies).where(eq(companies.id, id)).run()
    },

    // Per-service rollups for the /companies dashboard. Three small queries
    // beat one big GROUP-BY that joins all three tables — message totals
    // would multiply by chat count and need DISTINCT clauses to undo.
    getStats(companyId: number): CompanyStats {
      const chatRows = db
        .select({
          service: chats.service,
          chatCount: sql<number>`COUNT(*)`.as('chat_count'),
          lastScrapedAt: sql<Date | null>`MAX(${chats.updatedAt})`.as('last_scraped_at'),
        })
        .from(chats)
        .where(eq(chats.companyId, companyId))
        .groupBy(chats.service)
        .all()

      const contactRows = db
        .select({
          service: contacts.service,
          contactCount: sql<number>`COUNT(*)`.as('contact_count'),
        })
        .from(contacts)
        .where(eq(contacts.companyId, companyId))
        .groupBy(contacts.service)
        .all()

      const msgRows = db
        .select({
          service: chats.service,
          messageCount: sql<number>`COUNT(*)`.as('message_count'),
        })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(eq(chats.companyId, companyId))
        .groupBy(chats.service)
        .all()

      const merged = new Map<Service, CompanyServiceStats>()
      const ensure = (svc: Service): CompanyServiceStats => {
        const existing = merged.get(svc)
        if (existing) return existing
        const fresh: CompanyServiceStats = {
          service: svc,
          chatCount: 0,
          contactCount: 0,
          messageCount: 0,
          lastScrapedAt: null,
        }
        merged.set(svc, fresh)
        return fresh
      }
      for (const r of chatRows) {
        const e = ensure(r.service as Service)
        e.chatCount = Number(r.chatCount)
        // SQLite returns timestamps as numbers via drizzle's mapping; the
        // `mode: 'timestamp_ms'` column hints don't apply to raw SQL projections.
        e.lastScrapedAt =
          r.lastScrapedAt == null
            ? null
            : r.lastScrapedAt instanceof Date
              ? r.lastScrapedAt
              : new Date(Number(r.lastScrapedAt))
      }
      for (const r of contactRows) {
        ensure(r.service as Service).contactCount = Number(r.contactCount)
      }
      for (const r of msgRows) {
        ensure(r.service as Service).messageCount = Number(r.messageCount)
      }

      const byService = Array.from(merged.values()).sort((a, b) =>
        a.service.localeCompare(b.service),
      )

      return {
        companyId,
        byService,
        totalChats: byService.reduce((acc, s) => acc + s.chatCount, 0),
        totalContacts: byService.reduce((acc, s) => acc + s.contactCount, 0),
        totalMessages: byService.reduce((acc, s) => acc + s.messageCount, 0),
        lastActivityAt: byService.reduce<Date | null>((acc, s) => {
          if (!s.lastScrapedAt) return acc
          if (!acc) return s.lastScrapedAt
          return s.lastScrapedAt > acc ? s.lastScrapedAt : acc
        }, null),
      }
    },
  }
}
