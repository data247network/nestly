import { useEffect } from 'react'
import { pollChildCommands } from '../cloud/commands'

/**
 * Keeps the child-side command path alive independently of Bluetooth.
 * Five-second polling is the recovery path; foreground re-entry triggers an
 * immediate drain so lock/locate requests are not held until the next tick.
 */
export function CloudCommandBridge() {
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const poll = () => {
      if (!cancelled) void pollChildCommands().catch(() => {})
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll()
    }

    poll()
    timer = setInterval(poll, 5_000)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return null
}
