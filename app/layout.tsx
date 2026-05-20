import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SiteNav } from './_components/site-nav'
import { resolveScope } from './_lib/scope'
import { readThemeCookie } from './_lib/preferences'
import { listAdapters } from '../lib/scrapers/registry'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'TapTalk OneTalk scraper',
  description:
    'Multi-tenant chat scraper. Pick a company, pick a service, pull the data.',
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Load scope + theme + adapter registry once per request and pass them
  // down to the nav. Pages then no longer have to re-resolve scope just to
  // render the switcher — they call resolveScope() only when they need the
  // scope for their own queries.
  const [scope, theme] = await Promise.all([resolveScope(), readThemeCookie()])
  const services = listAdapters().map((a) => ({
    value: a.service,
    label: a.label,
  }))

  // `data-theme` is the trigger the @custom-variant in globals.css watches.
  // We set it eagerly to avoid the FOUC where the page paints in light
  // mode for one frame before the toggle's effect kicks in.
  const dataTheme = theme === 'system' ? undefined : theme

  return (
    <html
      lang="en"
      data-theme={dataTheme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteNav
          companies={scope?.companies ?? []}
          activeCompanyId={scope?.company.id ?? null}
          service={scope?.service ?? 'taptalk'}
          services={services}
          theme={theme}
        />
        {children}
      </body>
    </html>
  )
}
