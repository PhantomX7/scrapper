import { cookies } from 'next/headers'
import { SERVICES, type Service } from '../../lib/db/schema'

// All user-preference cookies in one module so the names + parsing rules
// stay in lockstep across reads (server components / route handlers) and
// writes (server actions).

const COMPANY_COOKIE = 'tt_scope_company'
const SERVICE_COOKIE = 'tt_scope_service'
const THEME_COOKIE = 'tt_theme'

const ONE_YEAR_S = 60 * 60 * 24 * 365

export type ThemePreference = 'light' | 'dark' | 'system'

function isService(value: string | undefined): value is Service {
  return !!value && (SERVICES as readonly string[]).includes(value)
}

function isTheme(value: string | undefined): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export async function readScopeCookies(): Promise<{
  companyId: number | null
  service: Service | null
}> {
  const c = await cookies()
  const rawCompany = c.get(COMPANY_COOKIE)?.value
  const rawService = c.get(SERVICE_COOKIE)?.value
  const companyId = rawCompany ? Number(rawCompany) : null
  return {
    companyId: Number.isInteger(companyId) && companyId! > 0 ? companyId : null,
    service: isService(rawService) ? rawService : null,
  }
}

export async function writeScopeCookies(input: {
  companyId: number
  service: Service
}): Promise<void> {
  const c = await cookies()
  c.set(COMPANY_COOKIE, String(input.companyId), {
    maxAge: ONE_YEAR_S,
    sameSite: 'lax',
    httpOnly: false,
  })
  c.set(SERVICE_COOKIE, input.service, {
    maxAge: ONE_YEAR_S,
    sameSite: 'lax',
    httpOnly: false,
  })
}

export async function clearScopeCookies(): Promise<void> {
  const c = await cookies()
  c.delete(COMPANY_COOKIE)
  c.delete(SERVICE_COOKIE)
}

export async function readThemeCookie(): Promise<ThemePreference> {
  const c = await cookies()
  const v = c.get(THEME_COOKIE)?.value
  return isTheme(v) ? v : 'system'
}

export async function writeThemeCookie(theme: ThemePreference): Promise<void> {
  const c = await cookies()
  c.set(THEME_COOKIE, theme, {
    maxAge: ONE_YEAR_S,
    sameSite: 'lax',
    httpOnly: false,
  })
}
