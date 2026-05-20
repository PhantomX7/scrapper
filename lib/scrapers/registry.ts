import type { Service } from '../db/schema'
import { SERVICES } from '../db/schema'
import { taptalkAdapter } from './taptalk'
import { whatsappAdapter } from './whatsapp'
import type { ScrapeAdapter } from './types'

// Single registry of every adapter. Adding a new service is a two-step
// change: implement the adapter under lib/scrapers/<name>/, then add it here.
// Keep the keys aligned with the SERVICES tuple in db/schema.ts so the type
// checker catches drift.
export const adapters: Record<Service, ScrapeAdapter> = {
  taptalk: taptalkAdapter as ScrapeAdapter,
  whatsapp: whatsappAdapter as ScrapeAdapter,
}

export function getAdapter(service: Service): ScrapeAdapter {
  const adapter = adapters[service]
  if (!adapter) {
    throw new Error(`Unknown service "${service}". Known: ${SERVICES.join(', ')}`)
  }
  return adapter
}

// Used by the dashboard to render the service picker. Order is significant —
// the first entry is the default selection.
export function listAdapters(): ScrapeAdapter[] {
  return SERVICES.map((s) => adapters[s])
}
