import { useCallback, useEffect, useRef, useState } from 'react'
import { hasCloud } from '../cloud/client'
import {
  loadEventsForChildren,
  loadHousehold,
  loadUsageForChildren,
  resolveHouseholdId,
  subscribeToChildren,
} from '../cloud/sync'
import { useDevice } from '../platform/device'
import { useStore } from './store'

/**
 * Fills the parent app's alerts, activity and reports from the cloud.
 *
 * Supabase is the primary remote source of truth. Bluetooth is only a local
 * fallback when the phones are together without internet. A realtime channel
 * triggers immediate hydration, while the periodic pull remains as a recovery
 * path when a socket is unavailable.
 */
const REFRESH_MS = 15_000

export function CloudHydrate() {
  const { role, children: liveChildren, pairings } = useDevice()
  const { dispatch } = useStore()
  const householdId = useRef<string | null>(null)
  const [cloudChildIds, setCloudChildIds] = useState<string[]>([])

  const boundLocalId = useCallback(
    (cloudId: string): string | null => {
      const paired = pairings.find((p) => p.cloudChildId === cloudId)
      if (paired) return paired.peerId
      const live = liveChildren.find((c) => c.cloudChildId === cloudId)
      return live?.deviceId ?? null
    },
    [pairings, liveChildren],
  )

  const localIdFor = useCallback(
    (cloudId: string) => boundLocalId(cloudId) ?? cloudId,
    [boundLocalId],
  )

  const pull = useCallback(async () => {
    if (!householdId.current) return
    try {
      const house = await loadHousehold(householdId.current)
      if (!house) return

      const cloudIds = house.children.map((c) => c.id)
      setCloudChildIds((current) => current.join(',') === cloudIds.join(',') ? current : cloudIds)
      if (cloudIds.length === 0) return

      dispatch({
        type: 'syncCloudChildren',
        children: house.children
          .filter((c) => boundLocalId(c.id) == null)
          .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar })),
      })

      const [events, usage] = await Promise.all([
        loadEventsForChildren(cloudIds).catch(() => []),
        loadUsageForChildren(cloudIds).catch(() => []),
      ])

      const byChild = new Map<string, typeof events>()
      for (const e of events) {
        const local = localIdFor(e.childId)
        const list = byChild.get(local) ?? []
        list.push(e)
        byChild.set(local, list)
      }

      for (const [childId, list] of byChild) {
        dispatch({
          type: 'ingestEvents',
          childId,
          events: [...list]
            .sort((a, b) => a.ts - b.ts)
            .map((e) => ({
              seq: e.seq,
              ts: e.ts,
              kind: e.kind,
              ...(e.ref ? { ref: e.ref } : {}),
              ...(e.cat ? { cat: e.cat as never } : {}),
            })),
        })
      }

      for (const u of usage) {
        dispatch({
          type: 'ingestUsage',
          childId: localIdFor(u.childId),
          day: u.day,
          apps: u.apps,
          sites: u.sites,
          usageAccess: u.usageAccess,
          filterOn: u.filterOn,
        })
      }
    } catch {
      // Offline is expected; retain the last locally available state.
    }
  }, [dispatch, boundLocalId, localIdFor])

  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let cancelled = false
    void (async () => {
      const id = await resolveHouseholdId().catch(() => null)
      if (cancelled || !id) return
      householdId.current = id
      await pull()
    })()
    return () => {
      cancelled = true
    }
  }, [role, pull])

  // Realtime is the fast path: child -> cloud -> parent app without waiting
  // for the polling interval. The callback only schedules a pull; it never
  // mutates the store directly, so all cloud data continues through one path.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent' || cloudChildIds.length === 0) return

    let timer: ReturnType<typeof setTimeout> | undefined
    const schedulePull = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void pull(), 250)
    }
    const stop = subscribeToChildren(cloudChildIds, schedulePull)
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [role, cloudChildIds, pull])

  // Poll as a recovery path and when the app returns to the foreground.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return

    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      if (!timer) timer = setInterval(() => void pull(), REFRESH_MS)
    }
    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void pull()
        start()
      } else stop()
    }

    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [role, pull])

  return null
}
