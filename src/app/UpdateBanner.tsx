import { useEffect, useState } from 'react'
import {
  checkForUpdate,
  installUpdate,
  updatesSupported,
  type UpdateStatus,
} from '../platform/updates'

/**
 * Non-blocking updater UI. Update checks must never be part of Nestly's
 * startup-critical path; a failed check is intentionally invisible unless the
 * user is already looking at an available update.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'unsupported' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!updatesSupported()) return

    // Defer the network/native updater work until after the first paint. The
    // Nestly UI must be usable even when the manifest, network or updater is
    // unavailable.
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((next) => {
        if (!cancelled) setStatus(next)
      })
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  if (status.state !== 'available' || dismissed) return null

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await installUpdate(status.manifest)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the update.')
    } finally {
      setBusy(false)
    }
  }

  const mb = (status.manifest.size / 1024 / 1024).toFixed(1)

  return (
    <div className="mx-4 mt-3 rounded-2xl bg-tint px-4 py-3">
      <div className="text-[13px] font-bold text-tealInk">
        Update available — {status.manifest.versionName}
      </div>
      <div className="mt-0.5 text-[11.5px] leading-relaxed text-tealInk">
        You have {status.currentVersionName}. {mb} MB.
        {status.manifest.notes ? ` ${status.manifest.notes}` : ''}
      </div>

      {error ? (
        <div className="mt-2 rounded-xl bg-coralBg px-3 py-2 text-[11.5px] text-coralInk">
          {error}
        </div>
      ) : null}

      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="rounded-xl bg-brand px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Downloading…' : 'Update now'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-xl px-3 py-2 text-[12.5px] font-bold text-tealInk"
        >
          Later
        </button>
      </div>
    </div>
  )
}
