import Link from 'next/link'
import { ensureMigrated, getDb } from '../../lib/db/client'
import {
  createContactsRepository,
  type ContactAggregateRow,
} from '../../lib/db/repositories'
import { censorPhone } from '../../lib/phone'
import { Pagination } from '../chats/_components/pagination'
import { resolveScope } from '../_lib/scope'
import { AppliedFilters, type FilterChip } from '../_components/applied-filters'
import { FilterBar } from './_components/filter-bar'
import { formatDurationMs } from './_lib/format'
import {
  buildContactsQuery,
  fromRawSearchParams,
  parseContactsFilters,
} from './_lib/filters'

export const dynamic = 'force-dynamic'

type RawSearchParams = Record<string, string | string[] | undefined>

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const params = await searchParams
  const parsed = parseContactsFilters(fromRawSearchParams(params))
  const scope = await resolveScope()

  if (!scope) return <NoCompaniesPage />

  ensureMigrated()
  const repo = createContactsRepository(getDb())
  const { rows, total } = repo.listAggregated(
    { companyId: scope.company.id, service: scope.service },
    {
      page: parsed.page,
      pageSize: parsed.size,
      dateFrom: parsed.dateFromDate,
      dateTo: parsed.dateToDate,
      search: parsed.q || undefined,
      sort: parsed.sort,
    },
  )

  const buildHref = (pageNum: number) =>
    `/contacts?${buildContactsQuery({
      page: pageNum,
      size: parsed.size,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      q: parsed.q,
      sort: parsed.sort,
      kw: parsed.kw,
    })}`

  const exportQuery = buildContactsQuery({
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    q: parsed.q,
    sort: parsed.sort,
    kw: parsed.kw,
  })
  const exportHref = exportQuery
    ? `/contacts/export?${exportQuery}`
    : '/contacts/export'

  // One chip per non-default filter value, each with a removeHref that
  // wipes only that field. Page is implicit (always reset to 1 on filter
  // change), pageSize is a UI preference rather than a "filter".
  const chips = buildChips(parsed)

  const totalMessages = rows.reduce((acc, r) => acc + r.messageCount, 0)
  const totalChats = rows.reduce((acc, r) => acc + r.chatCount, 0)
  const responseSamples = rows
    .map((r) => r.avgFirstResponseMs)
    .filter((v): v is number => v != null)
  const avgFirstResponseMs =
    responseSamples.length === 0
      ? null
      : responseSamples.reduce((a, b) => a + b, 0) / responseSamples.length
  const workingHourSamples = rows
    .map((r) => r.avgWorkingHourReplyMs)
    .filter((v): v is number => v != null)
  const avgWorkingHourReplyMs =
    workingHourSamples.length === 0
      ? null
      : workingHourSamples.reduce((a, b) => a + b, 0) / workingHourSamples.length

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Contacts
            </h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {total.toLocaleString()} unique contact{total === 1 ? '' : 's'} for{' '}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {scope.company.name}
              </span>{' '}
              on{' '}
              <span className="text-zinc-700 dark:text-zinc-300">
                {scope.service}
              </span>{' '}
              · the date filter applies to each contact&apos;s first chat.
            </p>
          </div>
        </header>

        <FilterBar
          dateFrom={parsed.dateFrom}
          dateTo={parsed.dateTo}
          q={parsed.q}
          sort={parsed.sort}
          size={parsed.size}
          total={total}
          exportHref={exportHref}
          kw={parsed.kw}
        />

        {chips.length > 0 && (
          <AppliedFilters chips={chips} clearHref="/contacts" />
        )}

        <SummaryStrip
          visible={rows.length}
          total={total}
          totalChats={totalChats}
          totalMessages={totalMessages}
          avgFirstResponseMs={avgFirstResponseMs}
          avgWorkingHourReplyMs={avgWorkingHourReplyMs}
        />

        {rows.length === 0 ? (
          <EmptyState hasFilters={chips.length > 0} />
        ) : (
          <ContactsTable rows={rows} />
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

const SORT_LABELS: Record<string, string> = {
  first_chat_desc: 'Newest first chat',
  oldest: 'Oldest first chat',
  recent: 'Most recent chat',
  most_chats: 'Most chats',
  most_messages: 'Most messages',
  name: 'Name A→Z',
}

function buildChips(parsed: ReturnType<typeof parseContactsFilters>): FilterChip[] {
  const out: FilterChip[] = []
  // Helper: build the URL with the named field removed, keeping every other.
  const without = (omit: 'dateFrom' | 'dateTo' | 'q' | 'sort' | 'kw') => {
    const next = {
      size: parsed.size,
      dateFrom: omit === 'dateFrom' ? '' : parsed.dateFrom,
      dateTo: omit === 'dateTo' ? '' : parsed.dateTo,
      q: omit === 'q' ? '' : parsed.q,
      sort: omit === 'sort' ? undefined : parsed.sort,
      kw: omit === 'kw' ? '' : parsed.kw,
    }
    const qs = buildContactsQuery(next)
    return qs ? `/contacts?${qs}` : '/contacts'
  }
  if (parsed.dateFrom || parsed.dateTo) {
    const value =
      parsed.dateFrom && parsed.dateTo
        ? `${parsed.dateFrom} → ${parsed.dateTo}`
        : parsed.dateFrom
          ? `from ${parsed.dateFrom}`
          : `until ${parsed.dateTo}`
    out.push({
      label: 'Date',
      value,
      // Remove both date fields together — splitting them in chips would be
      // confusing because dateTo without dateFrom is rarely meaningful.
      removeHref: (() => {
        const sp = new URLSearchParams()
        if (parsed.q) sp.set('q', parsed.q)
        if (parsed.sort !== 'first_chat_desc') sp.set('sort', parsed.sort)
        if (parsed.kw) sp.set('kw', parsed.kw)
        const qs = sp.toString()
        return qs ? `/contacts?${qs}` : '/contacts'
      })(),
    })
  }
  if (parsed.q) out.push({ label: 'Search', value: parsed.q, removeHref: without('q') })
  if (parsed.sort && parsed.sort !== 'first_chat_desc') {
    out.push({
      label: 'Sort',
      value: SORT_LABELS[parsed.sort] ?? parsed.sort,
      removeHref: without('sort'),
    })
  }
  if (parsed.kw) {
    out.push({
      label: 'Keywords',
      value: parsed.keywords.join(', '),
      removeHref: without('kw'),
    })
  }
  return out
}

function NoCompaniesPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 text-center dark:bg-zinc-950">
      <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        No companies yet.
      </h1>
      <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        Add a company first — contacts are stored under one.
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

function SummaryStrip({
  visible,
  total,
  totalChats,
  totalMessages,
  avgFirstResponseMs,
  avgWorkingHourReplyMs,
}: {
  visible: number
  total: number
  totalChats: number
  totalMessages: number
  avgFirstResponseMs: number | null
  avgWorkingHourReplyMs: number | null
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Contacts (page)" value={visible.toLocaleString()} />
      <Stat label="Contacts (total)" value={total.toLocaleString()} />
      <Stat label="Chats (page)" value={totalChats.toLocaleString()} />
      <Stat label="Messages (page)" value={totalMessages.toLocaleString()} />
      <Stat
        label="Avg first response (page)"
        value={avgFirstResponseMs == null ? '—' : formatDurationMs(avgFirstResponseMs)}
      />
      <Stat
        label="Avg WH reply (page)"
        value={
          avgWorkingHourReplyMs == null ? '—' : formatDurationMs(avgWorkingHourReplyMs)
        }
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  )
}

function ContactsTable({ rows }: { rows: ContactAggregateRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/50">
            <tr className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 text-right font-medium">Chats</th>
              <th className="px-4 py-3 text-right font-medium">Messages</th>
              <th className="px-4 py-3 font-medium">First chat</th>
              <th className="px-4 py-3 font-medium">First reply</th>
              <th className="px-4 py-3 text-right font-medium">Avg response</th>
              <th
                className="px-4 py-3 text-right font-medium"
                title="Average reply wait, counting only the portion that falls inside 9 AM – 5 PM GMT+7. Off-hours time does not accumulate."
              >
                Avg WH reply
              </th>
              <th className="px-4 py-3 font-medium">Last chat</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {rows.map((r) => {
              const chatsHref = `/contacts/${r.contactId}`
              return (
                <tr
                  key={r.contactId}
                  className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-3">
                    <Link href={chatsHref} className="block">
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">
                        {r.displayName ?? (
                          <span className="italic text-zinc-400">no name</span>
                        )}
                      </p>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {censorPhone(r.phone)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                    {r.chatCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                    {r.messageCount.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {formatDate(r.firstChatAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {formatDate(r.firstReplyAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {r.avgFirstResponseMs == null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      formatDurationMs(r.avgFirstResponseMs)
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
                    {r.avgWorkingHourReplyMs == null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      formatDurationMs(r.avgWorkingHourReplyMs)
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {formatDate(r.lastChatAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={chatsHref}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        {hasFilters ? 'No contacts match those filters.' : 'No contacts with phones yet.'}
      </h2>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {hasFilters
          ? 'Try widening the date range, switching scope from the top nav, or clearing the chips above.'
          : 'Once the scraper captures chats with phone numbers, they will appear here grouped by phone.'}
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

function formatDate(d: Date | null) {
  if (!d) return <span className="text-zinc-400">—</span>
  return d.toLocaleString()
}
