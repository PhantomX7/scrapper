import { ensureMigrated, getDb } from '../../lib/db/client'
import { createCompaniesRepository } from '../../lib/db/repositories'
import type { Company, Service } from '../../lib/db/schema'
import { readScopeCookies } from './preferences'

export type ScopeSelection = {
  company: Company
  service: Service
  // Every company we know about, sorted, so the picker can render
  // consistent dropdowns without each page hitting the DB twice.
  companies: Company[]
}

// Resolves the (company, service) the page should render for. Source of
// truth is the cookie set by the global ScopeSwitcher; if the cookie is
// missing or refers to a deleted company we fall back to the first
// company + 'taptalk'. Returns null when the DB has no companies — callers
// render an "add a company first" empty state in that case.
//
// URL-based scope was dropped in favor of cookies so navigating between
// /chats and /contacts preserves the active tenant without each link
// having to thread `?company=&service=` through every href.
export async function resolveScope(): Promise<ScopeSelection | null> {
  ensureMigrated()
  const repo = createCompaniesRepository(getDb())
  const companies = repo.list()
  if (companies.length === 0) return null

  const { companyId, service: cookieService } = await readScopeCookies()

  const company = companies.find((c) => c.id === companyId) ?? companies[0]
  const service: Service = cookieService ?? 'taptalk'

  return { company, service, companies }
}
