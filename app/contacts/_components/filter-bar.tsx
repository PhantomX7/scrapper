import Link from 'next/link'
import type { ContactsSortKey } from '../_lib/filters'

export function FilterBar({
  dateFrom,
  dateTo,
  q,
  sort,
  size,
  total,
  exportHref,
  kw,
}: {
  dateFrom: string
  dateTo: string
  q: string
  sort: ContactsSortKey
  size: number
  total: number
  exportHref: string
  kw: string
}) {
  const canExport = total > 0
  return (
    <form
      method="GET"
      action="/contacts"
      className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <input type="hidden" name="page" value="1" />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Date from
          </span>
          <input
            type="date"
            name="dateFrom"
            defaultValue={dateFrom}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200 dark:focus:ring-zinc-200/10"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Date to
          </span>
          <input
            type="date"
            name="dateTo"
            defaultValue={dateTo}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200 dark:focus:ring-zinc-200/10"
          />
        </label>

        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Search
          </span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Phone or name…"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-200 dark:focus:ring-zinc-200/10"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Sort
          </span>
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200 dark:focus:ring-zinc-200/10"
          >
            <option value="first_chat_desc">Newest first chat</option>
            <option value="oldest">Oldest first chat</option>
            <option value="recent">Most recent chat</option>
            <option value="most_chats">Most chats</option>
            <option value="most_messages">Most messages</option>
            <option value="name">Name A→Z</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Per page
          </span>
          <select
            name="size"
            defaultValue={size}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-200 dark:focus:ring-zinc-200/10"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Apply
          </button>
          <Link
            href="/contacts"
            className="inline-flex items-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Reset
          </Link>
          {canExport ? (
            <a
              href={exportHref}
              download
              title={`Export all ${total.toLocaleString()} matching contact${total === 1 ? '' : 's'} to Excel`}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
            >
              Export to Excel
            </a>
          ) : (
            <span
              aria-disabled
              title="No contacts to export"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
            >
              Export to Excel
            </span>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Transaction keywords (export only)
        </span>
        <input
          type="text"
          name="kw"
          defaultValue={kw}
          placeholder="e.g. payment, order, invoice"
          title="Comma-separated. Each contact's chat messages are scanned for any of these keywords (case-insensitive). The export adds a 'Has transaction' column."
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-200 dark:focus:ring-zinc-200/10"
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Comma-separated. Match is case-insensitive against message body and caption.
        </span>
      </label>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {total.toLocaleString()} unique contact{total === 1 ? '' : 's'} in this range.
        {canExport && ' Export downloads all rows across every page.'}
      </p>
    </form>
  )
}
