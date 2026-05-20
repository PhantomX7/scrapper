// Constants and type aliases shared with client components.
// Kept out of actions.ts because a `'use server'` file can only export
// async functions — re-exporting `initialCreateCompanyState` from there
// fails the Next.js build.

export type CreateCompanyState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  // The newly-created company id, surfaced so the dashboard can switch to it.
  companyId?: number
}

export const initialCreateCompanyState: CreateCompanyState = { status: 'idle' }
