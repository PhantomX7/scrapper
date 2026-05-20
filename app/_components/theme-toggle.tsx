'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setTheme } from '../actions'
import type { ThemePreference } from '../_lib/preferences'

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

const LABEL: Record<ThemePreference, string> = {
  system: 'Auto',
  light: 'Light',
  dark: 'Dark',
}

// Three-way toggle (system → light → dark → …) cycled by clicks. Cookie
// drives the actual theme; flipping it via a server action keeps SSR and
// CSR consistent — no hydration flash.
export function ThemeToggle({ theme }: { theme: ThemePreference }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function cycle() {
    const next = NEXT[theme]
    const fd = new FormData()
    fd.set('theme', next)
    startTransition(async () => {
      await setTheme(fd)
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={pending}
      title={`Theme: ${LABEL[theme]} — click to change`}
      aria-label={`Theme: ${LABEL[theme]}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
    >
      <ThemeIcon theme={theme} />
      <span className="hidden sm:inline">{LABEL[theme]}</span>
    </button>
  )
}

function ThemeIcon({ theme }: { theme: ThemePreference }) {
  if (theme === 'light') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (theme === 'dark') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
