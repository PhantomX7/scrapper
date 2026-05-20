'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Scrape' },
  { href: '/chats', label: 'Chats' },
  { href: '/contacts', label: 'Contacts' },
  { href: '/companies', label: 'Companies' },
]

// Client island just for active-link highlighting. Splitting this out of
// SiteNav lets the rest of the nav stay server-rendered, which avoids
// hydrating the whole header on every page.
export function NavLinks() {
  const pathname = usePathname()
  return (
    <ul className="flex items-center gap-0.5">
      {LINKS.map((link) => {
        const active =
          link.href === '/'
            ? pathname === '/'
            : pathname.startsWith(link.href)
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                active
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              {link.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
