import type { Service } from '../lib/db/schema'

export type ChatMessage = {
  id: string
  direction: 'in' | 'out' | 'info'
  senderName?: string
  isAgent?: boolean
  body?: string
  imageUrl?: string
  fileName?: string
  caption?: string
  replyToName?: string
  replyToText?: string
  timestamp?: string
}

export type ChatRow = {
  id: string
  name: string
  createdAt: string
  firstResponseAt?: string
  firstResponseWait?: string
  resolvedAt?: string
  caseDuration?: string
  firstMessage?: string
  contactPhone?: string
  messages?: ChatMessage[]
}

export type ScrapeLogLevel = 'info' | 'warn' | 'error'

export type ScrapeLog = {
  level: ScrapeLogLevel
  message: string
  at: string
}

export type ScrapeArtifact = {
  label: string
  relativePath: string
}

// Compact post-run summary the dashboard uses to render the "saved" card +
// CTA links to /chats and /contacts. Replaces the full results table that
// duplicated what /chats already shows.
export type ScrapeSummary = {
  chats: number
  messages: number
  contacts: number
  companyName: string
  companySlug: string
  service: Service
}

export type ScrapeResult = {
  status: 'idle' | 'success' | 'error'
  ranAt?: string
  logs: ScrapeLog[]
  summary?: ScrapeSummary
  artifacts: ScrapeArtifact[]
  error?: string
  isMock: boolean
}

export const initialScrapeState: ScrapeResult = {
  status: 'idle',
  logs: [],
  artifacts: [],
  isMock: false,
}
