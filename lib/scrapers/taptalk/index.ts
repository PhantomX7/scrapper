import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ScrapeAdapter, ScrapeContext } from '../types'
import { scrapeChatList, type TaptalkInput } from './scraper'

function storageStatePath(ctx: ScrapeContext): string {
  return path.join(
    process.cwd(),
    '.data',
    'storage',
    `${ctx.companySlug}-${ctx.service}.json`,
  )
}

export const taptalkAdapter: ScrapeAdapter<TaptalkInput> = {
  service: 'taptalk',
  label: 'TapTalk OneTalk',
  fields: [
    {
      name: 'email',
      label: 'Email',
      type: 'email',
      required: true,
      autoComplete: 'username',
      placeholder: 'you@example.com',
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      required: true,
      autoComplete: 'current-password',
      placeholder: '••••••••',
    },
    {
      name: 'dateFrom',
      label: 'Date from',
      type: 'date',
      hint: 'Blank = today.',
    },
    {
      name: 'dateTo',
      label: 'Date to',
      type: 'date',
      hint: 'Blank = same as Date from.',
    },
    {
      name: 'maxChats',
      label: 'Max chats',
      type: 'number',
      defaultValue: '100',
      min: 1,
      max: 500_000,
      hint: 'Safety cap on rows extracted per run.',
    },
  ],
  // Names that the dashboard hides behind a disclosure when a saved
  // session exists — the password is the painful one to retype every run.
  credentialFieldNames: ['email', 'password'],
  parseInput(formData) {
    // When the credential disclosure is closed, the inputs are unmounted —
    // an empty email/password means "use the saved session". Only error if
    // the user explicitly typed one but not the other.
    const email = String(formData.get('email') ?? '').trim()
    const password = String(formData.get('password') ?? '')
    if ((email && !password) || (!email && password)) {
      throw new Error('Provide both email and password, or leave both blank to reuse the saved session.')
    }
    const dateFrom = String(formData.get('dateFrom') ?? '').trim() || undefined
    const dateTo = String(formData.get('dateTo') ?? '').trim() || undefined
    const maxChats = Math.max(
      1,
      Math.min(500_000, Number(formData.get('maxChats') ?? 100)),
    )
    return { email, password, dateFrom, dateTo, maxChats }
  },
  scrape(input, ctx) {
    return scrapeChatList(input, ctx)
  },
  hasSavedSession(ctx) {
    return existsSync(storageStatePath(ctx))
  },
}
