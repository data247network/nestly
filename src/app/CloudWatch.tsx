import { useCallback, useEffect, useRef, useState } from 'react'
import { hasCloud } from '../cloud/client'
import {
  existingHouseholdId,
  loadHousehold,
  type HouseholdSummary,
} from '../cloud/sync'
import { subscribeToChildrenSafe } from '../cloud/realtime'
import { useDevice } from '../platform/device'

const REFRESH_INTERVAL_MS = 15_000

/** Parent's cloud-first view of children, independent of Bluetooth pairing. */
export function useCloudChildren(): {
  household: HouseholdSummary | null
  updatedAt: number | null
  loading: boolean
  refresh: () => Promise<void>
} {
  const { role } = useDevice()
  const [household, setHousehold] = useState<HouseholdSummary | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const householdId = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!householdId.current) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await loadHousehold(householdId.current)
      if (next) {
        setHousehold(next)
        setUpdatedAt(Date.now())
      }
    } catch {
      // Keep the last successful cloud snapshot while offline.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!hasCloud() || role !== 'parent') {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      // Always resolve the authenticated user's membership first. A cached
      // household can survive sign-out/re-sign-in and point at an old family.
      const id = await existingHouseholdId().catch(() => null)
      if (cancelled) return
      if (!id) {
        setLoading(false)
        return
      }
      householdId.current = id
      await refresh()
    })()
    return () => {
      cancelled = true
    }
  }, [role, refresh])

  const childKey = (household?.children ?? []).map((c) => c.id).sort().join(',')

  useEffect(() => {
    if (!hasCloud() || role !== 'parent' || !childKey) return
    let pending: ReturnType<typeof setTimeout> | undefined
    const stop = subscribeToChildrenSafe(childKey.split(','), () => {
      clearTimeout(pending)
      pending = setTimeout(() => void refresh(), 500)
    })
    return () => {
      clearTimeout(pending)
      stop()
    }
  }, [role, childKey, refresh])

  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      if (!timer) timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    }
    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
        start()
      } else stop()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [role, refresh])

  return { household, updatedAt, loading, refresh }
}
