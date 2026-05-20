import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../schema'
import type { Service } from '../schema'

// Repositories accept any drizzle binding — the top-level db or a transaction
// passed into db.transaction(). Typing it this way lets callers compose the
// same code paths inside or outside a transaction without duplication.
export type DbLike = BetterSQLite3Database<typeof schema>

// The (companyId, service) tuple every list/upsert call gets scoped by.
// Stored as a single value so callers can't accidentally pass one but
// forget the other.
export type Scope = {
  companyId: number
  service: Service
}
