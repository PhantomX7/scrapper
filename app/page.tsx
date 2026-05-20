import Link from 'next/link'
import { ScrapeDashboard } from './_components/scrape-dashboard'
import { WhatsappPairCard } from './_components/whatsapp-pair-card'
import { resolveScope } from './_lib/scope'
import { getAdapter } from '../lib/scrapers/registry'
import { readSession } from '../lib/scrapers/whatsapp/session'

// The scrape dashboard renders for the active scope (set via the global
// ScopeSwitcher). Re-resolves on every request so a scope flip in one tab
// is reflected immediately in another.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const scope = await resolveScope()

  if (!scope) {
    return <NoCompaniesPage />
  }

  const adapter = getAdapter(scope.service)
  // Saved-session detection runs server-side, scoped to the active
  // (company, service). Skip the credential disclosure when the adapter
  // already has a usable session on disk.
  const hasSavedSession =
    (await adapter.hasSavedSession?.({
      companyId: scope.company.id,
      companySlug: scope.company.slug,
      service: scope.service,
    })) ?? false

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10 sm:px-8">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {scope.company.name} · {adapter.label}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Run a scrape
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Switch tenants from the top nav. Add a new service by dropping an
            adapter into <code className="font-mono text-xs">lib/scrapers/</code>.
          </p>
        </header>

        {scope.service === 'whatsapp' && (
          <WhatsappPairCard
            initialPhoneJid={
              readSession({
                companyId: scope.company.id,
                companySlug: scope.company.slug,
                service: 'whatsapp',
              })?.phoneJid
            }
          />
        )}

        <ScrapeDashboard
          adapter={{
            service: adapter.service,
            label: adapter.label,
            fields: adapter.fields,
            credentialFieldNames: adapter.credentialFieldNames ?? [],
          }}
          hasSavedSession={hasSavedSession}
        />
      </main>
    </div>
  )
}

function NoCompaniesPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Add a company to get started
        </h1>
        <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
          Every scrape, contact, and chat is filed under one company. Once you
          create one, the top-nav switcher will let you flip between tenants
          and services.
        </p>
        <Link
          href="/companies"
          className="mt-2 inline-flex items-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Add a company
        </Link>
      </main>
    </div>
  )
}
