import { useEffect, useRef } from 'react'
import { hasCloud } from '../cloud/client'
import { currentSession, forgetDeviceToken, registerDeviceToken } from '../cloud/sync'
import { currentPushToken, pushSupported, startPush, stopPush } from '../platform/push'
import { useDevice } from '../platform/device'
import { useStore } from './store'

/** Signing out must not be blocked by the network, so the release is bounded. */
const RELEASE_TIMEOUT_MS = 3000

/**
 * Registers this parent's phone for push, and opens the feed when one is
 * tapped.
 *
 * Separate from `CloudBridge` for the same reason that one is separate from
 * `PolicyBridge`: this is the newest and least essential of the three, and it
 * must not be able to take the other two down with it. Nothing here throws
 * outward, and a phone where registration fails — permission refused, no Play
 * Services, no network — keeps working exactly as it did before push existed.
 *
 * Mounted only in the signed-in parent branch of `App`. A child device has no
 * account to register a token against, and would be the wrong phone to buzz.
 */
export function PushBridge() {
  const { role } = useDevice()
  const { go } = useStore()

  // `go` is stable today, but reading it through a ref keeps it out of the
  // effect's dependencies regardless — re-running would tear down and re-attach
  // the native listeners, and a notification tapped mid-swap lands nowhere.
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  }, [go])

  useEffect(() => {
    if (!hasCloud() || !pushSupported() || role !== 'parent') return

    let cancelled = false
    let stop: (() => void) | null = null

    void (async () => {
      // Without a session the token has no owner to be written against, and
      // RLS would refuse it. Sign-in remounts this, so there is nothing to
      // retry here.
      const session = await currentSession()
      if (cancelled || !session) return

      const cleanup = await startPush({
        onToken: (token) => {
          // Fires on every launch with the same value, and again whenever
          // Firebase rotates it. Both cases are the same write.
          void registerDeviceToken(token).catch(() => {
            /* Retried on the next launch. The alert still reached the server. */
          })
        },
        onUnavailable: () => {
          // Deliberately silent. A parent who has turned notifications off has
          // said what they want, and the alerts feed is unaffected.
        },
        onOpened: (payload) => {
          // A note is a message and belongs in the thread; everything else is
          // an alert and belongs in the feed. Landing a tapped note on the
          // alerts list would show a parent a screen their note is not on.
          //
          // The payload names the child, but the store keys children by their
          // Bluetooth pairing rather than their cloud id, so resolving one to
          // the other here would duplicate what CloudBridge already does. Both
          // destinations carry every child, and the tapped one is on it.
          goRef.current(payload.kind === 'note' ? 'hub' : 'alerts')
        },
      })

      // Sign-out can land while the permission dialog is still up.
      if (cancelled) {
        cleanup()
        return
      }
      stop = cleanup
    })()

    return () => {
      cancelled = true
      stop?.()
    }
  }, [role])

  return null
}

/**
 * Unsubscribes this phone before signing out.
 *
 * Called from the sign-out action rather than from a cleanup effect on purpose.
 * An effect cleanup does not run when the app is killed, which is exactly when
 * the registration should survive, and it *does* run on React's development
 * double-mount, which would race the re-registration that immediately follows.
 * Sign-out is the one moment the token genuinely should go.
 *
 * Both halves matter. Dropping only the server row leaves the handset
 * registered and re-adding itself on the next token rotation; unregistering
 * only at Firebase leaves a dead row the sender keeps trying.
 */
export async function releasePush(): Promise<void> {
  const token = currentPushToken()
  if (token && hasCloud()) {
    // A phone with no signal still has to be able to sign out. The row is a
    // stale token at worst, and the sender prunes those the first time Firebase
    // tells it the registration is gone.
    await Promise.race([
      forgetDeviceToken(token).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS)),
    ])
  }
  await stopPush()
}
