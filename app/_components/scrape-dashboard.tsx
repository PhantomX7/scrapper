'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { runScrape } from '../actions'
import {
  initialScrapeState,
  type ScrapeArtifact,
  type ScrapeResult,
  type ScrapeSummary,
} from '../scrape-types'
import type { ScrapeFormField } from '../../lib/scrapers/types'
import type { Service } from '../../lib/db/schema'

export type AdapterDescriptor = {
  service: Service
  label: string
  fields: ScrapeFormField[]
  // Names of `fields` that should hide behind the credentials disclosure
  // when a saved session exists.
  credentialFieldNames: readonly string[]
}

export function ScrapeDashboard({
  adapter,
  hasSavedSession,
}: {
  adapter: AdapterDescriptor
  hasSavedSession: boolean
}) {
  const [state, formAction, pending] = useActionState<ScrapeResult, FormData>(
    runScrape,
    initialScrapeState,
  )

  // Whether the credentials section is open. Defaults closed when we have
  // a saved session (the common case after the first run); the user can
  // expand it to override credentials manually.
  const [credentialsOpen, setCredentialsOpen] = useState(!hasSavedSession)

  const credentialFields = adapter.fields.filter((f) =>
    adapter.credentialFieldNames.includes(f.name),
  )
  const optionFields = adapter.fields.filter(
    (f) => !adapter.credentialFieldNames.includes(f.name),
  )

  return (
    <div className="flex flex-col gap-5">
      <form action={formAction} className="flex flex-col gap-5">
        {credentialFields.length > 0 && (
          <CredentialCard
            fields={credentialFields}
            open={credentialsOpen}
            setOpen={setCredentialsOpen}
            hasSavedSession={hasSavedSession}
          />
        )}

        {optionFields.length > 0 && (
          <Card title="Run options">
            <div className="grid gap-4 sm:grid-cols-2">
              {optionFields.map((f) => (
                <DynamicField key={f.name} field={f} />
              ))}
            </div>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Results auto-save under the active company. Open them on{' '}
            <Link href="/chats" className="underline-offset-2 hover:underline">
              Chats
            </Link>{' '}
            or{' '}
            <Link
              href="/contacts"
              className="underline-offset-2 hover:underline"
            >
              Contacts
            </Link>
            .
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {pending ? (
              <>
                <Spinner />
                Running…
              </>
            ) : hasSavedSession && !credentialsOpen ? (
              'Run · using saved session'
            ) : (
              'Run scrape'
            )}
          </button>
        </div>
      </form>

      <StatusPanel state={state} pending={pending} />

      {state.status === 'success' && state.summary && (
        <SummaryCard summary={state.summary} />
      )}

      {state.artifacts.length > 0 && <ArtifactsPanel artifacts={state.artifacts} />}
    </div>
  )
}

function CredentialCard({
  fields,
  open,
  setOpen,
  hasSavedSession,
}: {
  fields: ScrapeFormField[]
  open: boolean
  setOpen: (open: boolean) => void
  hasSavedSession: boolean
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SessionBadge active={hasSavedSession} />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {hasSavedSession ? 'Saved session in use' : 'Sign in'}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {hasSavedSession
                ? 'Credentials only needed if the session expired or you want to switch accounts.'
                : 'No saved session for this scope yet — credentials required.'}
            </p>
          </div>
        </div>
        {hasSavedSession && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="text-xs font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {open ? 'Hide credentials' : 'Re-enter credentials'}
          </button>
        )}
      </header>

      {open && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <DynamicField key={f.name} field={f} />
          ))}
        </div>
      )}
    </section>
  )
}

function SessionBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
        aria-hidden
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 7.5l2.5 2.5L11 4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  return (
    <span
      className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M7 1v6M7 9.5v.5M7 13a6 6 0 100-12 6 6 0 000 12z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

function SummaryCard({ summary }: { summary: ScrapeSummary }) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            Saved to {summary.companyName} · {summary.service}
          </h2>
          <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-200/80">
            Auto-persisted via idempotent upserts — re-running just refreshes the rows.
          </p>
        </div>
      </header>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Chats" value={summary.chats} />
        <Stat label="Messages" value={summary.messages} />
        <Stat label="Contacts" value={summary.contacts} />
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/chats"
          className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          View chats →
        </Link>
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-50 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-200 dark:hover:bg-emerald-950/40"
        >
          View contacts →
        </Link>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-emerald-900 dark:text-emerald-50">
        {value.toLocaleString()}
      </dd>
    </div>
  )
}

function DynamicField({ field }: { field: ScrapeFormField }) {
  const fullWidth = field.type === 'number' || field.type === 'text'
  return (
    <label className={`flex flex-col gap-1.5 ${fullWidth ? 'sm:col-span-2' : ''}`}>
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {field.label}
      </span>
      <input
        name={field.name}
        type={field.type}
        required={field.required}
        autoComplete={field.autoComplete}
        placeholder={field.placeholder}
        defaultValue={field.defaultValue}
        min={field.min}
        max={field.max}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-200 dark:focus:ring-zinc-200/10"
      />
      {field.hint && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{field.hint}</span>
      )}
    </label>
  )
}

function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
          )}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

function StatusPanel({ state, pending }: { state: ScrapeResult; pending: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (state.status === 'idle' && !pending) return null

  const tone =
    state.status === 'error'
      ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30'
      : pending
        ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30'
        : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40'

  const headline = pending
    ? 'Running scrape…'
    : state.status === 'error'
      ? 'Run failed'
      : state.ranAt
        ? `Last run · ${new Date(state.ranAt).toLocaleString()}`
        : 'Idle'

  // Always show the most recent line so the user has feedback at a glance.
  // Full log opens via the disclosure.
  const latest = state.logs[state.logs.length - 1]

  return (
    <section className={`rounded-2xl border p-4 ${tone}`}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {pending && <Spinner />}
          <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {headline}
          </h2>
        </div>
        {state.logs.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {expanded
              ? 'Hide log'
              : `Show log (${state.logs.length})`}
          </button>
        )}
      </header>
      {state.error && (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{state.error}</p>
      )}
      {!expanded && latest && (
        <p className="mt-2 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">
          <span className={logColor(latest.level)}>[{latest.level}]</span>{' '}
          {latest.message}
        </p>
      )}
      {expanded && state.logs.length > 0 && (
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-lg bg-white/50 p-2 font-mono text-xs text-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-300">
          {state.logs.map((entry, idx) => (
            <li key={idx} className="flex gap-2">
              <span className="text-zinc-400 dark:text-zinc-500">
                {new Date(entry.at).toLocaleTimeString()}
              </span>
              <span className={logColor(entry.level)}>[{entry.level}]</span>
              <span className="flex-1 whitespace-pre-wrap wrap-break-word">{entry.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ArtifactsPanel({ artifacts }: { artifacts: ScrapeArtifact[] }) {
  return (
    <Card
      title="Debug artifacts"
      subtitle="Saved under .data/artifacts/<company>-<service>/ so you can inspect what the scraper saw."
    >
      <ul className="space-y-1 font-mono text-xs">
        {artifacts.map((a) => (
          <li key={a.relativePath} className="flex gap-2">
            <span className="text-zinc-500 dark:text-zinc-400">{a.label}:</span>
            <span className="text-zinc-800 dark:text-zinc-200">{a.relativePath}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function logColor(level: 'info' | 'warn' | 'error') {
  if (level === 'error') return 'text-red-600 dark:text-red-400'
  if (level === 'warn') return 'text-amber-600 dark:text-amber-400'
  return 'text-zinc-500 dark:text-zinc-400'
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M4 12a8 8 0 018-8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}
