'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCompany } from '../../actions'

// Typed-confirm delete: the user has to retype the slug before the destroy
// button enables. Cheap insurance against fat-fingering "Delete" — the
// action cascades to every chat / message / contact under the company, so
// it's worth the extra step.
export function DeleteCompanyButton({
  id,
  slug,
  name,
}: {
  id: number
  slug: string
  name: string
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function destroy() {
    if (confirm !== slug) return
    const fd = new FormData()
    fd.set('id', String(id))
    fd.set('confirm', slug)
    startTransition(async () => {
      await deleteCompany(fd)
      setOpen(false)
      setConfirm('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-full border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-950 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        Delete
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900/60 dark:bg-red-950/30">
      <p className="text-red-800 dark:text-red-200">
        Type <span className="font-mono font-semibold">{slug}</span> to delete
        <span className="font-semibold"> {name}</span> and all its data.
      </p>
      <div className="flex w-full items-center gap-2">
        <input
          type="text"
          value={confirm}
          autoFocus
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={slug}
          className="min-w-0 flex-1 rounded-md border border-red-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20 dark:border-red-900/60 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <button
          type="button"
          onClick={destroy}
          disabled={confirm !== slug || pending}
          className="inline-flex items-center rounded-full bg-red-700 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setConfirm('')
          }}
          className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
