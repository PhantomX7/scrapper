import Link from 'next/link'
import { ensureMigrated, getDb } from '../../lib/db/client'
import {
  createCompaniesRepository,
  type CompanyStats,
} from '../../lib/db/repositories/companies'
import { listAdapters } from '../../lib/scrapers/registry'
import type { Company } from '../../lib/db/schema'
import { CreateCompanyForm } from './_components/create-form'
import { DeleteCompanyButton } from './_components/delete-form'

export const dynamic = 'force-dynamic'

export default async function CompaniesPage() {
  ensureMigrated()
  const repo = createCompaniesRepository(getDb())
  const companies = repo.list()
  // One stats query per company is fine — this is a config page, not a hot
  // path. Keeps the per-card render dead simple.
  const statsByCompany: Map<number, CompanyStats> = new Map(
    companies.map((c) => [c.id, repo.getStats(c.id)] as const),
  )

  const services = listAdapters()

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Companies
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">
              {companies.length} tenant{companies.length === 1 ? '' : 's'}. Each
              scrape, contact, and chat is filed under one. Pick the active
              tenant from the global switcher in the top nav.
            </p>
          </div>
        </header>

        <CreateCompanyCard />

        {companies.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {companies.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                stats={statsByCompany.get(c.id)!}
                services={services.map((a) => ({
                  service: a.service,
                  label: a.label,
                }))}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function CreateCompanyCard() {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Add a company
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          The slug auto-derives from the name if you leave it blank. It&apos;s
          used for storage filenames so two companies on the same service stay
          isolated.
        </p>
      </header>
      <CreateCompanyForm />
    </section>
  )
}

function CompanyCard({
  company,
  stats,
  services,
}: {
  company: Company
  stats: CompanyStats
  services: { service: string; label: string }[]
}) {
  const empty = stats.totalChats === 0
  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900"
            aria-hidden
          >
            {company.name.slice(0, 1)}
          </span>
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {company.name}
            </h3>
            <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {company.slug} · since{' '}
              {company.createdAt.toLocaleDateString()}
            </p>
          </div>
        </div>
        <DeleteCompanyButton id={company.id} slug={company.slug} name={company.name} />
      </header>

      {empty ? (
        <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
          No scrapes yet.{' '}
          <Link
            href="/"
            className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
          >
            Switch to this company
          </Link>{' '}
          and run one.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Chats" value={stats.totalChats} />
            <Stat label="Messages" value={stats.totalMessages} />
            <Stat label="Contacts" value={stats.totalContacts} />
          </dl>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Per service
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-xs">
              {services.map((s) => {
                const row = stats.byService.find((b) => b.service === s.service)
                return (
                  <li
                    key={s.service}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-900 dark:bg-zinc-900/40"
                  >
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">
                      {s.label}
                    </span>
                    {row ? (
                      <span className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
                        <span>{row.chatCount.toLocaleString()} chats</span>
                        <span>·</span>
                        <span>{row.contactCount.toLocaleString()} contacts</span>
                        {row.lastScrapedAt && (
                          <>
                            <span>·</span>
                            <span title={row.lastScrapedAt.toISOString()}>
                              {formatRelative(row.lastScrapedAt)}
                            </span>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="italic text-zinc-400 dark:text-zinc-500">
                        no runs
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </li>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-900 dark:bg-zinc-900/40">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value.toLocaleString()}
      </dd>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        No companies yet
      </h2>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        Add your first company above. Once added, it becomes the active tenant
        automatically and the top-nav switcher unlocks.
      </p>
    </div>
  )
}

// Compact relative time without pulling in a date library — we only need
// "5m ago" / "3h ago" / "2d ago" / fallback to the locale date.
function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return d.toLocaleDateString()
}
