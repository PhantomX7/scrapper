import type { ChatRow, ScrapeArtifact, ScrapeLog } from '../../app/scrape-types'
import type { Service } from '../db/schema'

// Identifies the tenant + adapter the run is being executed for. Adapters use
// `companySlug` to namespace their on-disk state (e.g. saved login cookies)
// so two companies sharing the same source service don't stomp on each other.
export type ScrapeContext = {
  companyId: number
  companySlug: string
  service: Service
}

// What every adapter returns. The shape is a strict superset of "what the DB
// + UI need" — adapters that don't surface a particular field should leave it
// undefined rather than fabricate a value.
export type ScrapeOutput = {
  chats: ChatRow[]
  logs: ScrapeLog[]
  artifacts: ScrapeArtifact[]
  landingUrl?: string
}

// Adapters declare a self-describing form schema so the dashboard can render
// the right credential / options inputs per service without hard-coding them.
// `name` becomes the FormData key the server action reads back.
export type ScrapeFieldType = 'text' | 'password' | 'email' | 'date' | 'number'

export type ScrapeFormField = {
  name: string
  label: string
  type: ScrapeFieldType
  required?: boolean
  placeholder?: string
  hint?: string
  defaultValue?: string
  autoComplete?: string
  min?: number
  max?: number
}

export interface ScrapeAdapter<TInput = Record<string, unknown>> {
  service: Service
  // Human-readable label shown in the service picker.
  label: string
  // Fields rendered into the scrape form for this adapter.
  fields: ScrapeFormField[]
  // Subset of `fields` that should be hidden behind a disclosure when a
  // saved session exists for this scope — the dashboard re-shows them only
  // if the user clicks "Re-enter credentials" or `hasSavedSession()`
  // returns false. Names must match `fields[].name` entries.
  credentialFieldNames?: readonly string[]
  // Pull the typed input out of the submitted FormData. Throw if a required
  // field is missing — the action wraps the throw into a user-facing error.
  parseInput(formData: FormData): TInput
  scrape(input: TInput, ctx: ScrapeContext): Promise<ScrapeOutput>
  // True when a previous run's auth state is still on disk for this scope,
  // so the dashboard can collapse the credential card. Optional — adapters
  // that don't have a session concept can omit it.
  hasSavedSession?(ctx: ScrapeContext): boolean | Promise<boolean>
}
