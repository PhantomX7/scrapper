import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { ScrapeContext } from '../types'

// Per-(company, service) device record. Mirrors TapTalk's `${slug}-${service}.json`
// storage convention so the rest of the codebase doesn't need to learn a new
// "saved session" location.
export type WhatsappSession = {
  deviceId: string
  phoneJid?: string
  pairedAt?: string
}

const STORAGE_DIR = path.join(process.cwd(), '.data', 'storage')

export function sessionPath(ctx: { companySlug: string; service: string }): string {
  return path.join(STORAGE_DIR, `${ctx.companySlug}-${ctx.service}.json`)
}

export function readSession(ctx: ScrapeContext): WhatsappSession | null {
  const p = sessionPath(ctx)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as WhatsappSession
  } catch {
    return null
  }
}

export function writeSession(ctx: ScrapeContext, session: WhatsappSession): void {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true })
  writeFileSync(sessionPath(ctx), JSON.stringify(session, null, 2), 'utf8')
}

export function deleteSession(ctx: ScrapeContext): void {
  const p = sessionPath(ctx)
  if (existsSync(p)) rmSync(p)
}
