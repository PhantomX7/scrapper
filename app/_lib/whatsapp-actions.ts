'use server'

import { revalidatePath } from 'next/cache'
import { ensureMigrated, getDb } from '../../lib/db/client'
import { createCompaniesRepository } from '../../lib/db/repositories'
import {
  addDevice,
  deviceLogin,
  deviceStatus,
  removeDevice,
} from '../../lib/whatsapp/client'
import {
  deleteSession,
  readSession,
  writeSession,
} from '../../lib/scrapers/whatsapp/session'
import { readScopeCookies } from './preferences'

// Resolve the scoped (companySlug, deviceId?) for the active scope. All actions
// in this file are scoped to the cookie-selected company; the user picks the
// company from the top-nav switcher.
async function resolveCtx() {
  const { companyId } = await readScopeCookies()
  if (!companyId) return null
  ensureMigrated()
  const company = createCompaniesRepository(getDb()).findById(companyId)
  if (!company) return null
  return { companyId: company.id, companySlug: company.slug, service: 'whatsapp' as const }
}

export type PairStartResult =
  | { ok: true; deviceId: string; qrLink: string; qrDuration: number }
  | { ok: false; error: string }

// Create the device on the WA service (or reuse the saved one), kick off a QR
// session, and return the link to the QR image hosted by the service.
export async function startWhatsappPair(): Promise<PairStartResult> {
  const ctx = await resolveCtx()
  if (!ctx) return { ok: false, error: 'No active company. Pick one from the top nav.' }

  try {
    let session = readSession(ctx)
    if (!session) {
      const created = await addDevice()
      session = { deviceId: created.id }
      writeSession(ctx, session)
    }

    const login = await deviceLogin(session.deviceId)
    // The QR link points to the internal Docker service (e.g.
    // http://whatsapp:2777/...) which the browser can't reach. Rewrite it
    // to go through our own proxy route so the image loads correctly.
    const proxiedQrLink = `/api/whatsapp-qr?url=${encodeURIComponent(login.qr_link)}`
    return {
      ok: true,
      deviceId: session.deviceId,
      qrLink: proxiedQrLink,
      qrDuration: login.qr_duration,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

export type PairStatusResult =
  | { ok: true; isConnected: boolean; isLoggedIn: boolean; phoneJid?: string }
  | { ok: false; error: string }

export async function checkWhatsappStatus(): Promise<PairStatusResult> {
  const ctx = await resolveCtx()
  if (!ctx) return { ok: false, error: 'No active company.' }

  const session = readSession(ctx)
  if (!session) return { ok: false, error: 'No device created yet.' }

  try {
    const s = await deviceStatus(session.deviceId)
    // Persist the WA phone JID the first time we see it logged in, so the
    // dashboard can show which account is paired.
    if (s.is_logged_in && s.device_id && session.phoneJid !== s.device_id) {
      writeSession(ctx, {
        ...session,
        phoneJid: s.device_id,
        pairedAt: session.pairedAt ?? new Date().toISOString(),
      })
    }
    return {
      ok: true,
      isConnected: s.is_connected,
      isLoggedIn: s.is_logged_in,
      phoneJid: s.device_id,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// "Unpair": delete the device on the service + wipe the local JSON. Lets the
// user start fresh without manual file deletion.
export async function unpairWhatsapp(): Promise<{ ok: boolean; error?: string }> {
  const ctx = await resolveCtx()
  if (!ctx) return { ok: false, error: 'No active company.' }

  const session = readSession(ctx)
  if (!session) return { ok: true }

  try {
    await removeDevice(session.deviceId).catch(() => {
      // Best-effort: if the device is already gone on the service we still
      // want to wipe the local file.
    })
    deleteSession(ctx)
    revalidatePath('/')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// Called by the client after pairing succeeds so the dashboard re-renders
// with the credential card collapsed.
export async function revalidateAfterPair(): Promise<void> {
  revalidatePath('/')
}
