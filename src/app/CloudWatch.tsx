import { useCallback, useEffect, useRef, useState } from 'react'
import { hasCloud } from '../cloud/client'
import {
  loadHousehold,
  resolveHouseholdId,
  type HouseholdSummary,
} from '../cloud/sync'
import { subscribeToChildrenSafe } from '../cloud/realtime'
import { useDevice } from '../platform/device'

/**
 * The parent's live view of children who are nowhere near them.
 *
 * `CloudBridge` pushes what arrives over Bluetooth *up*. This is the other
 * direction, and it is the half that makes the product work at a distance: the
 * child's phone now uploads on its own, so a parent at work can see a child at
 * school without the two phones ever being in range.
 *
 * Reads only. Bluetooth remains the authority when both phones are together —
 * it is fresher and works with no signal — so nothing here writes to the local
 * store or touches policy. A cloud outage costs a parent remote visibility and
 * nothing else.
 */
const REFRESH_INTERVAL_MS = 15_000

export function useCloudChildren(): {
  household: HouseholdSummary | null
  /** Wall-clock time of the last successful read, for a staleness indicator. */
  updatedAt: number | null
} {
  const { role } = useDevice()
  const [household, setHousehold] = useState<HouseholdSummary | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const householdId = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!householdId.current) return
    try {
      const next = await loadHousehold(householdId.current)
      if (next) {
        setHousehold(next)
        setUpdatedAt(Date.now())
      }
    } catch {
      // Offline is the normal state for this product, not an error to surface.
      // The screen keeps showing the last good read with its timestamp.
    }
  }, [])

  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let cancelled = false

    void (async () => {
      const id = await resolveHouseholdId().catch(() => null)
      if (cancelled || !id) return
      householdId.current = id
      await refresh()
    })()

    return () => {
      cancelled = true
    }
  }, [role, refresh])

  const childKey = (household?.children ?? [])
    .map((c) => c.id)
    .sort()
    .join(',')

  useEffect(() => {
    if (!hasCloud() || role !== 'parent' || !childKey) return

    // Debounced: a child coming back into signal flushes its whole backlog, and
    // one reload per row would hammer the API for no extra information.
    let pending: ReturnType<typeof setTimeout> | undefined
    const stop = subscribeToChildrenSafe(childKey.split(','), () => {
      clearTimeout(pending)
      pending = setTimeout(() => void refresh(), 800)
    })

    return () => {
      clearTimeout(pending)
      stop()
    }
  }, [role, childKey, refresh])

  // A timed refresh underneath the socket.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent' || !childKey) return

    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      if (timer) return
      timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    }
    const stopTimer = () => {
      clearInterval(timer)
      timer = undefined
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
        start()
      } else {
        stopTimer()
      }
    }

    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stopTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [role, childKey, refresh])

  return { household, updatedAt }
}
