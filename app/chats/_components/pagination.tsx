import Link from 'next/link'

export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
}: {
  page: number
  pageSize: number
  total: number
  buildHref: (page: number) => string
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  const pages = windowed(page, totalPages)

  const prev = Math.max(1, page - 1)
  const next = Math.min(totalPages, page + 1)

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <span className="text-zinc-600 dark:text-zinc-400">
        Showing <span className="font-medium text-zinc-900 dark:text-zinc-100">{from.toLocaleString()}</span>–
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{to.toLocaleString()}</span> of{' '}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{total.toLocaleString()}</span>
      </span>
      <ul className="flex items-center gap-1">
        <li>
          <PageLink href={buildHref(prev)} disabled={page === 1} ariaLabel="Previous page">
            ←
          </PageLink>
        </li>
        {pages.map((p, idx) =>
          p === 'ellipsis' ? (
            <li key={`e-${idx}`} className="px-2 text-zinc-400">
              …
            </li>
          ) : (
            <li key={p}>
              <PageLink href={buildHref(p)} active={p === page}>
                {p}
              </PageLink>
            </li>
          ),
        )}
        <li>
          <PageLink href={buildHref(next)} disabled={page === totalPages} ariaLabel="Next page">
            →
          </PageLink>
        </li>
      </ul>
    </nav>
  )
}

function PageLink({
  href,
  children,
  active,
  disabled,
  ariaLabel,
}: {
  href: string
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  ariaLabel?: string
}) {
  const base =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors'
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} cursor-not-allowed text-zinc-300 dark:text-zinc-700`}
      >
        {children}
      </span>
    )
  }
  const tone = active
    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      className={`${base} ${tone}`}
    >
      {children}
    </Link>
  )
}

// Compact pager: first, last, neighbors of current, with ellipses between.
function windowed(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const result: (number | 'ellipsis')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) result.push('ellipsis')
  for (let i = start; i <= end; i++) result.push(i)
  if (end < total - 1) result.push('ellipsis')
  result.push(total)
  return result
}
