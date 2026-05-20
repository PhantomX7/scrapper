import Link from 'next/link'

export type FilterChip = {
  label: string
  value: string
  // GET link that strips this filter from the URL.
  removeHref: string
}

// Renders the active non-default filters as chips so users can see what's
// in effect without re-opening the form, and remove any one with a click.
// Server-rendered — chips just navigate, no JS needed.
export function AppliedFilters({
  chips,
  clearHref,
}: {
  chips: FilterChip[]
  // Where "Clear all" points to (the page with no filters at all).
  clearHref: string
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-zinc-500 dark:text-zinc-400">
        Filters:
      </span>
      {chips.map((chip) => (
        <Link
          key={`${chip.label}:${chip.value}`}
          href={chip.removeHref}
          aria-label={`Remove filter ${chip.label}: ${chip.value}`}
          className="group inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <span className="text-zinc-500 dark:text-zinc-400">{chip.label}:</span>
          <span className="font-medium">{chip.value}</span>
          <span
            aria-hidden
            className="text-zinc-400 transition-colors group-hover:text-zinc-700 dark:text-zinc-500 dark:group-hover:text-zinc-200"
          >
            ×
          </span>
        </Link>
      ))}
      {chips.length > 1 && (
        <Link
          href={clearHref}
          className="text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Clear all
        </Link>
      )}
    </div>
  )
}
