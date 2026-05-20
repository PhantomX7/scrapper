'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  checkWhatsappStatus,
  revalidateAfterPair,
  startWhatsappPair,
  unpairWhatsapp,
} from '../_lib/whatsapp-actions'

type PairState = {
  deviceId?: string
  qrLink?: string
  // Seconds left until the QR expires; counts down to 0 then we re-request
  // a fresh one automatically.
  expiresAt?: number
  status: 'idle' | 'fetching-qr' | 'awaiting-scan' | 'paired' | 'error'
  error?: string
  phoneJid?: string
}

export function WhatsappPairCard({
  initialPhoneJid,
}: {
  // Passed from the server when a session already exists, so the card opens
  // in "paired" mode without an extra status round-trip.
  initialPhoneJid?: string
}) {
  const router = useRouter()
  const [state, setState] = useState<PairState>(
    initialPhoneJid
      ? { status: 'paired', phoneJid: initialPhoneJid }
      : { status: 'idle' },
  )
  const [pending, startTransition] = useTransition()
  // Updated by a ticking effect so the rendered countdown is pure — Date.now()
  // during render would violate react-hooks/purity.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => () => stopPolling(), [])

  async function requestQr() {
    setState((s) => ({ ...s, status: 'fetching-qr', error: undefined }))
    const res = await startWhatsappPair()
    if (!res.ok) {
      setState({ status: 'error', error: res.error })
      setSecondsLeft(null)
      return
    }
    setState({
      status: 'awaiting-scan',
      deviceId: res.deviceId,
      qrLink: res.qrLink,
      expiresAt: Date.now() + res.qrDuration * 1000,
    })
    // Seed the countdown with the duration the API gave us; the interval
    // below decrements it once per second. Setting it here (outside an
    // effect) keeps the effect free of synchronous setState.
    setSecondsLeft(res.qrDuration)
  }

  // 1s ticker that decrements the displayed countdown. The expiry check
  // lives in the poll effect so it only fires once per QR.
  useEffect(() => {
    if (state.status !== 'awaiting-scan') return
    const id = setInterval(() => {
      setSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1)))
    }, 1000)
    return () => clearInterval(id)
  }, [state.status])

  // Poll every 2s while waiting for the user to scan. We also refresh the
  // QR image when its declared duration elapses — the service hands out a
  // new link each /login call.
  useEffect(() => {
    if (state.status !== 'awaiting-scan') return
    stopPolling()
    pollRef.current = setInterval(async () => {
      const expired = state.expiresAt && Date.now() > state.expiresAt
      if (expired) {
        await requestQr()
        return
      }
      const s = await checkWhatsappStatus()
      if (!s.ok) {
        setState({ status: 'error', error: s.error })
        return
      }
      if (s.isLoggedIn) {
        stopPolling()
        setState({ status: 'paired', phoneJid: s.phoneJid })
        startTransition(async () => {
          await revalidateAfterPair()
          router.refresh()
        })
      }
    }, 2000)
    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.expiresAt])

  async function handleUnpair() {
    if (!confirm('Unpair this WhatsApp device? You will need to scan the QR again to reconnect.')) return
    setState({ status: 'idle' })
    await unpairWhatsapp()
    router.refresh()
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge active={state.status === 'paired'} />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {state.status === 'paired' ? 'WhatsApp paired' : 'Pair WhatsApp device'}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {state.status === 'paired'
                ? state.phoneJid
                  ? `Connected as ${state.phoneJid}.`
                  : 'Device is logged in and ready.'
                : 'Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → scan the QR.'}
            </p>
          </div>
        </div>
        {state.status === 'paired' && (
          <button
            type="button"
            onClick={handleUnpair}
            className="text-xs font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Unpair
          </button>
        )}
      </header>

      {state.status === 'idle' && (
        <div className="mt-4">
          <button
            type="button"
            onClick={requestQr}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Generate QR code
          </button>
        </div>
      )}

      {state.status === 'fetching-qr' && (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Asking the service for a fresh QR…</p>
      )}

      {state.status === 'awaiting-scan' && state.qrLink && (
        <div className="mt-4 flex flex-col items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- QR is hosted by the WhatsApp service, no point routing through next/image */}
          <img
            src={state.qrLink}
            alt="WhatsApp pairing QR"
            width={256}
            height={256}
            className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Polling for scan… the QR auto-refreshes in {secondsLeft ?? '?'}s.
          </p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="mt-4 flex flex-col items-start gap-2">
          <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
          <button
            type="button"
            onClick={requestQr}
            className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Try again
          </button>
        </div>
      )}
    </section>
  )
}

function Badge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
        aria-hidden
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 7.5l2.5 2.5L11 4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  return (
    <span
      className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 7h10M7 2v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  )
}
