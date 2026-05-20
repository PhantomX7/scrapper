import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from './schema'

const DEFAULT_PATH = resolve(process.cwd(), '.data', 'taptalk.sqlite')
const DB_PATH = process.env.DATABASE_URL ?? DEFAULT_PATH
const MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle')

// Cache the Database + drizzle instance on globalThis so Next.js HMR in dev
// doesn't open a new file handle on every module reload.
type Cache = {
  sqlite?: Database.Database
  db?: ReturnType<typeof drizzle<typeof schema>>
  migrated?: boolean
}
const cache = globalThis as unknown as { __taptalkDb?: Cache }
cache.__taptalkDb ??= {}

function openSqlite() {
  if (cache.__taptalkDb!.sqlite) return cache.__taptalkDb!.sqlite
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const sqlite = new Database(DB_PATH)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  cache.__taptalkDb!.sqlite = sqlite
  return sqlite
}

export function getDb() {
  if (cache.__taptalkDb!.db) return cache.__taptalkDb!.db
  const instance = drizzle(openSqlite(), { schema })
  cache.__taptalkDb!.db = instance
  return instance
}

// Migrator is idempotent, but we guard anyway — in dev, HMR can re-import
// this module many times per session.
export function ensureMigrated() {
  if (cache.__taptalkDb!.migrated) return
  migrate(getDb(), { migrationsFolder: MIGRATIONS_DIR })
  cache.__taptalkDb!.migrated = true
}

export type DB = ReturnType<typeof getDb>
