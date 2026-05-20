'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Company, Service } from '../../lib/db/schema'
import { setScope } from '../actions'

// Compact dropdown that lives in the nav and replaces every per-page
// ScopePicker. Submitting calls the setScope server action which writes
// the cookie + revalidates the layout — every page picks up the new scope
// without per-page wiring.
export function ScopeSwitcher({
  companies,
  activeCompanyId,
  service,
  services,
}: {
  companies: Company[]
  activeCompanyId: number | null
  service: Service
  services: { value: Service; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const labelId = useId()

  if (companies.length === 0) {
    return (
      <Link
        href="/companies"
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <span aria-hidden>+</span>
        Add a company
      </Link>
    )
  }

  const active =
    companies.find((c) => c.id === activeCompanyId) ?? companies[0]
  const activeServiceLabel =
    services.find((s) => s.value === service)?.label ?? service

  function commit(nextCompanyId: number, nextService: Service) {
    const fd = new FormData()
    fd.set('companyId', String(nextCompanyId))
    fd.set('service', nextService)
    setOpen(false)
    if (detailsRef.current) detailsRef.current.open = false
    startTransition(async () => {
      await setScope(fd)
      router.refresh()
    })
  }

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group relative"
    >
      <summary
        aria-labelledby={labelId}
        className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 group-open:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:group-open:border-zinc-600"
      >
        <span
          className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold uppercase text-white dark:bg-zinc-100 dark:text-zinc-900"
          aria-hidden
        >
          {active.name.slice(0, 1)}
        </span>
        <span id={labelId} className="flex flex-col items-start leading-tight">
          <span className="text-zinc-900 dark:text-zinc-50">{active.name}</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {activeServiceLabel}
          </span>
        </span>
        <Chevron />
      </summary>

      <div className="absolute left-0 right-auto top-full z-50 mt-2 w-72 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:w-80">
        <Section label="Company">
          <ul className="flex flex-col">
            {companies.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => commit(c.id, service)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    c.id === active.id
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                  {c.id === active.id && <Tick />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 px-2 pb-1">
            <Link
              href="/companies"
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              Manage companies →
            </Link>
          </div>
        </Section>

        <div className="my-1 border-t border-zinc-100 dark:border-zinc-900" />

        <Section label="Service">
          <ul className="flex flex-col">
            {services.map((s) => (
              <li key={s.value}>
                <button
                  type="button"
                  onClick={() => commit(active.id, s.value)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    s.value === service
                      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                  }`}
                >
                  <span className="truncate">{s.label}</span>
                  {s.value === service && <Tick />}
                </button>
              </li>
            ))}
          </ul>
        </Section>

        {pending && (
          <p className="mt-1 px-2 text-xs text-zinc-500 dark:text-zinc-400">
            Switching…
          </p>
        )}
      </div>
    </details>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      {children}
    </div>
  )
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className="text-zinc-400 dark:text-zinc-500"
    >
      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Tick() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden
      className="text-zinc-900 dark:text-zinc-50"
    >
      <path d="M3 7.5l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
