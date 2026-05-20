'use client'

import { useActionState, useEffect, useRef } from 'react'
import { createCompany } from '../../actions'
import { initialCreateCompanyState } from '../../actions-types'

export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState(
    createCompany,
    initialCreateCompanyState,
  )
  const formRef = useRef<HTMLFormElement>(null)

  // Clear the form after a successful submit so adding a second company is
  // not a "delete the previous values first" exercise.
  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state.status])

  return (
    <form ref={formRef} action={formAction} className="mt-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Name
          </span>
          <input
            name="name"
            type="text"
            required
            placeholder="Acme Corp"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Slug (optional)
          </span>
          <input
            name="slug"
            type="text"
            placeholder="acme-corp"
            pattern="[a-zA-Z0-9 \-]+"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? 'Creating…' : 'Add company'}
        </button>
        {state.status === 'success' && state.message && (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">{state.message}</p>
        )}
        {state.status === 'error' && state.message && (
          <p className="text-sm text-red-700 dark:text-red-300">{state.message}</p>
        )}
      </div>
    </form>
  )
}
