import Link from 'next/link'
import { ensureMigrated, getDb } from '../../lib/db/client'
import { createChatsRepository, type ChatListRow } from '../../lib/db/repositories'
import { censorPhone } from '../../lib/phone'
import { resolveScope } from '../_lib/scope'
import { AppliedFilters, type FilterChip } from '../_components/applied-filters'
import { FilterBar } from './_components/filter-bar'
import { Pagination } from './_components/pagination'

// This page reads live DB state per request, so disable static rendering.
// (It's dynamic anyway because we consume searchParams, but being explicit
// avoids surprises if the params are ever unused on some path.)
export const dynamic = 'force-dynamic'

type RawSearchParams = Record<string, string | string[] | undefined>

// Next.js 16: `searchParams` is a Promise — destructure via `await`.
export default async function ChatsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const params = await searchParams
  const parsed = parseParams(params)
  const scope = await resolveScope()

  if (!scope) return <NoCompaniesPage />

  ensureMigrated()
  const repo = createChatsRepository(getDb())
  const { rows, total } = repo.list(
    { companyId: scope.company.id, service: scope.service },
    {
      page: parsed.page,
      pageSize: parsed.size,
      search: parsed.q || undefined,
      sort: parsed.sort,
    },
  )

  // Scope no longer rides in the URL — buildHref only encodes filters.
  const buildHref = (pageNum: number) => {
    const sp = new URLSearchParams()
    sp.set('page', String(pageNum))
    if (parsed.size !== DEFAULT_SIZE) sp.set('size', String(parsed.size))
    if (parsed.q) sp.set('q', parsed.q)
    if (parsed.sort !== 'newest') sp.set('sort', parsed.sort)
    return `/chats?${sp.toString()}`
  }

  const chips: FilterChip[] = []
  if (parsed.q) {
    chips.push({
      label: 'Search',
      value: parsed.q,
      removeHref: buildResetHref(parsed, 'q'),
    })
  }
  if (parsed.sort !== 'newest') {
    chips.push({
      label: 'Sort',
      value: SORT_LABELS[parsed.sort],
      removeHref: buildResetHref(parsed, 'sort'),
    })
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 sm:px-8">
        <PageHeader
          companyName={scope.company.name}
          service={scope.service}
          total={total}
        />

        <FilterBar q={parsed.q} sort={parsed.sort} size={parsed.size} total={total} />

        {chips.length > 0 && <AppliedFilters chips={chips} clearHref="/chats" />}

        {rows.length === 0 ? (
          <EmptyState hasFilters={chips.length > 0} />
        ) : (
          <ChatsTable rows={rows} />
        )}

        <Pagination
          page={parsed.page}
          pageSize={parsed.size}
          total={total}
          buildHref={buildHref}
        />
      </main>
    </div>
  )
}

const DEFAULT_SIZE = 25

const SORT_LABELS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  recently_saved: 'Recently saved',
} as const

function parseParams(params: RawSearchParams) {
  const first = (k: string) => {
    const v = params[k]
    return Array.isArray(v) ? v[0] : v
  }

  const page = Math.max(1, Number(first('page')) || 1)
  const sizeRaw = Number(first('size'))
  const size = [10, 25, 50, 100].includes(sizeRaw) ? sizeRaw : DEFAULT_SIZE
  const q = (first('q') ?? '').trim()
  const sortRaw = first('sort')
  const sort: 'newest' | 'oldest' | 'recently_saved' =
    sortRaw === 'oldest' || sortRaw === 'recently_saved' ? sortRaw : 'newest'

  return { page, size, q, sort }
}

function buildResetHref(
  parsed: ReturnType<typeof parseParams>,
  removeKey: 'q' | 'sort',
) {
  const sp = new URLSearchParams()
  if (parsed.size !== DEFAULT_SIZE) sp.set('size', String(parsed.size))
  if (removeKey !== 'q' && parsed.q) sp.set('q', parsed.q)
  if (removeKey !== 'sort' && parsed.sort !== 'newest') sp.set('sort', parsed.sort)
  const qs = sp.toString()
  return qs ? `/chats?${qs}` : '/chats'
}

function PageHeader({
  companyName,
  service,
  total,
}: {
  companyName: string
  service: string
  total: number
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Chats
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {total.toLocaleString()} chat{total === 1 ? '' : 's'} for{' '}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {companyName}
          </span>{' '}
          on <span className="text-zinc-700 dark:text-zinc-300">{service}</span>.
        </p>
      </div>
    </header>
  )
}

function NoCompaniesPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 text-center dark:bg-zinc-950">
      <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        No companies yet.
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        Add a company first — chats are stored under one.
      </p>
      <Link
        href="/companies"
        className="mt-4 inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Add a company
      </Link>
    </div>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {hasFilters ? 'No chats match those filters.' : 'No chats stored yet.'}
      </h2>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {hasFilters
          ? 'Try clearing the filter chips above, switching scope from the top nav, or running a new scrape.'
          : 'Run a scrape on the home page — results are saved to the database automatically.'}
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Go to scraper
      </Link>
    </div>
  )
}

function ChatsTable({ rows }: { rows: ChatListRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/50">
            <tr className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Chat</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Resolved</th>
              <th className="px-4 py-3 font-medium">Case duration</th>
              <th className="px-4 py-3 font-medium">Messages</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {rows.map((r) => (
              <tr
                key={r.id}
                className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/50"
              >
                <td className="px-4 py-3">
                  <Link href={`/chats/${r.id}`} className="block">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">{r.name}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {r.firstMessage ?? <span className="italic">no first message</span>}
                    </p>
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  {r.contactPhoneRaw || r.contactPhone ? (
                    censorPhone(r.contactPhoneRaw ?? r.contactPhone)
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {formatDate(r.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {formatDate(r.resolvedAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {r.caseDuration ?? <Dash />}
                </td>
                <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                  {r.messageCount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/chats/${r.id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Dash() {
  return <span className="text-zinc-400">—</span>
}

function formatDate(d: Date | null) {
  if (!d) return <Dash />
  return d.toLocaleString()
}
