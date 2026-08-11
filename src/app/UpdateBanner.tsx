import { useEffect, useState } from 'react'
import {
  checkForUpdate,
  installUpdate,
  updatesSupported,
  type UpdateStatus,
} from '../platform/updates'

/**
 * Tells a parent there is a newer build, and fetches it on request.
 *
 * Sideloaded apps have no store watching over them, so without this a phone
 * stays on its original build forever. It appears only when there is genuinely
 * something newer — no "you are up to date" banner, which is noise on every
 * launch to say nothing happened.
 *
 * Shown on the parent's phone only. A child cannot be asked to approve an
 * install dialog they have no context for, and a parent updating their own
 * phone is the case that matters: the two ends negotiate a protocol version, so
 * the parent is where a mismatch gets noticed.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'unsupported' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!updatesSupported()) return
    // Once per launch. Polling a manifest on a timer would spend a family's
    // data to learn nothing on almost every check.
    void checkForUpdate().then(setStatus)
  }, [])

  if (status.state !== 'available' || dismissed) return null

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await installUpdate(status.manifest)
      // Android's installer takes over here. If the user goes through with it
      // the app is replaced; if they cancel, this banner is still correct.
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
