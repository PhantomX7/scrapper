// Server-rendered filter bar. Submitting the form reloads the page with the
// new search params — no client JS needed and the URL stays shareable.
// Scope (company/service) lives in a cookie, so it doesn't ride the URL.
export function FilterBar({
  q,
  sort,
  size,
  total,
}: {
  q: string
  sort: 'newest' | 'oldest' | 'recently_saved'
  size: number
  total: number
}) {
  return (
    <form
      method="GET"
      action="/chats"
      className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      {/* Any form submit resets pagination to page 1. */}
      <input type="hidden" name="page" value="1" />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Search
          </span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name, phone, first message…"
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
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="recently_saved">Recently saved</option>
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
          <a
            href="/chats"
            className="inline-flex items-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Reset
          </a>
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {total.toLocaleString()} chat{total === 1 ? '' : 's'} match
        {total === 1 ? 'es' : ''} these filters.
      </p>
    </form>
  )
}
