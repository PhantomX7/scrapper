import type { ScrapeAdapter } from '../types'
import { scrapeChatList, type WhatsappInput } from './scraper'
import { readSession } from './session'

export const whatsappAdapter: ScrapeAdapter<WhatsappInput> = {
  service: 'whatsapp',
  label: 'WhatsApp',
  // No text credentials — pairing happens via QR code through the
  // WhatsappPairCard rendered on the dashboard when no session exists.
  fields: [
    {
      name: 'dateFrom',
      label: 'Date from',
      type: 'date',
      hint: 'Blank = no lower bound.',
    },
    {
      name: 'dateTo',
      label: 'Date to',
      type: 'date',
      hint: 'Blank = no upper bound.',
    },
    {
      name: 'maxChats',
      label: 'Max chats',
      type: 'number',
      defaultValue: '100',
      min: 1,
      max: 500_000,
      hint: 'Safety cap on chats fetched per run.',
    },
  ],
  credentialFieldNames: [],
  parseInput(formData) {
    const dateFrom = String(formData.get('dateFrom') ?? '').trim() || undefined
    const dateTo = String(formData.get('dateTo') ?? '').trim() || undefined
    const maxChats = Math.max(
      1,
      Math.min(500_000, Number(formData.get('maxChats') ?? 100)),
    )
    return { dateFrom, dateTo, maxChats }
  },
  scrape(input, ctx) {
    return scrapeChatList(input, ctx)
  },
  hasSavedSession(ctx) {
    return readSession(ctx) !== null
  },
}
