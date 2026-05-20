import Link from 'next/link'
import type { Company, Service } from '../../lib/db/schema'
import type { ThemePreference } from '../_lib/preferences'
import { NavLinks } from './nav-links'
import { ScopeSwitcher } from './scope-switcher'
import { ThemeToggle } from './theme-toggle'

export function SiteNav({
  companies,
  activeCompanyId,
  service,
  services,
  theme,
}: {
  companies: Company[]
  activeCompanyId: number | null
  service: Service
  services: { value: Service; label: string }[]
  theme: ThemePreference
}) {
  return (
    <nav className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-2.5 sm:gap-6 sm:px-8">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          taptalk-scrap
        </Link>
        <ScopeSwitcher
          companies={companies}
          activeCompanyId={activeCompanyId}
          service={service}
          services={services}
        />
        <div className="ml-auto flex items-center gap-2">
          <NavLinks />
          <span className="hidden h-5 w-px bg-zinc-200 dark:bg-zinc-800 sm:inline-block" />
          <ThemeToggle theme={theme} />
        </div>
      </div>
    </nav>
  )
}
