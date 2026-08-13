import { useCallback, useEffect, useState } from 'react'
import {
  checkForUpdate,
  installUpdate,
  installedVersion,
  updatesSupported,
  type UpdateStatus,
} from '../platform/updates'

/**
 * Which build this phone is on, and a way to ask whether there is a newer one.
 *
 * `UpdateBanner` only ever appears when an update is waiting, which is correct
 * for a banner — nobody wants "you are up to date" on every launch — but it
 * left no way to answer the question directly. A parent who had heard a fix was
 * out had nothing to press and no version number to compare, so the only way to
 * find out was to reinstall and see.
 *
 * Shown on both phones. The child's device is the one enforcing routines, so
 * "which build is that phone on" is a question about whether a fix has actually
 * landed where it matters, not a diagnostic nicety.
 */
export function VersionRow() {
  const [installed, setInstalled] = useState<{ versionCode: number; versionName: string } | null>(
    null,
  )
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void installedVersion().then(setInstalled)
  }, [])

  const check = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      setStatus(await checkForUpdate())
    } catch {
      setStatus({ state: 'error', message: 'Could not reach the update service.' })
    } finally {
      setChecking(false)
    }
  }, [])

  const install = async () => {
    if (status?.state !== 'available') return
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

  // Off-device the browser always has the current code, and there is no APK to
  // replace — a version number there would describe nothing anyone can act on.
  if (!updatesSupported()) return null

  return (
    <div className="rounded-2xl border border-line px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-bold">
            Nestly {installed ? installed.versionName : '—'}
          </div>
          <div className="mt-0.5 text-[11.5px] text-body">
            {installed ? `Build ${installed.versionCode}. ` : ''}
            {describe(status, checking)}
          </div>
        </div>
        <button
          type="button"
          disabled={checking || busy}
          onClick={() => void check()}
          className="shrink-0 rounded-xl border border-line px-4 py-2.5 text-[12.5px] font-bold text-brand disabled:opacity-50"
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {status?.state === 'available' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void install()}
          className="mt-3 w-full rounded-xl bg-brand px-3.5 py-2.5 text-[12.5px] font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Downloading…' : `Update to ${status.manifest.versionName}`}
        </button>
      ) : null}

      {error ? (
        <div className="mt-2 rounded-xl bg-coralBg px-3 py-2 text-[11.5px] text-coralInk">
          {error}
        </div>
      ) : null}
    </div>
  )
}

/** The one line under the version, which is the whole point of the control. */
function describe(status: UpdateStatus | null, checking: boolean): string {
  if (checking) return 'Checking for a newer build…'
  if (!status) return 'Tap to check for a newer build.'
  switch (status.state) {
    case 'current':
      return 'This is the latest build.'
    case 'available':
      return `Version ${status.manifest.versionName} is available.`
    case 'error':
      // Said plainly rather than as "up to date". A failed check is not the
      // same as being current, and reporting it as such is how a phone sits on
      // an old build believing it is fine.
      return `Could not check — ${status.message}`
    default:
      return 'Updates are not available on this device.'
  }
}
