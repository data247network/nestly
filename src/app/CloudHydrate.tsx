import { useCallback, useEffect, useRef } from 'react'
import { hasCloud } from '../cloud/client'
import {
  currentSession,
  loadEventsForChildren,
  loadHousehold,
  loadUsageForChildren,
} from '../cloud/sync'
import { HOUSEHOLD_KEY } from '../screens/login'
import { loadJSON } from '../platform/storage'
import { useDevice } from '../platform/device'
import { useStore } from './store'

/**
 * Fills the parent app's alerts, activity and reports from the cloud.
 *
 * Those three screens read `state.alerts`, `state.activity` and
 * `state.usageByChild` — store fields only the Bluetooth link ever wrote. So
 * with the two phones apart, a parent opening Alerts or Reports saw nothing,
 * while the server held the full history. The map worked, because it reads
 * cloud telemetry directly; everything else did not.
 *
 * This feeds the *same* actions the radio uses rather than adding a parallel
 * set of cloud-only fields. The ingest reducer de-duplicates on
 * `(childId, seq)`, and both links carry the same sequence numbers, so an event
 * that arrives twice collapses to one entry with no coordination between them —
 * and every screen keeps working unchanged.
 *
 * Nothing here writes policy or touches the radio. With no signal the app
 * behaves exactly as it did before; this only stops the screens being empty
 * when there *is* a signal.
 */

/** Matches the poll in `useCloudChildren`, for the same reason. */
const REFRESH_MS = 15_000

export function CloudHydrate() {
  const { role, children: liveChildren } = useDevice()
  const { dispatch } = useStore()
  const householdId = useRef<string | null>(null)

  /**
   * Maps a cloud child id onto the id this app files its data under.
   *
   * A child that is also paired over Bluetooth already exists locally under its
   * pairing id, and its `Hello` carries the cloud id — so events must land on
   * the pairing id or the same child would appear twice, once per link. A child
   * that has never been paired has no such id and is filed under the cloud one.
   */
  const localIdFor = useCallback(
    (cloudId: string) =>
      liveChildren.find((c) => c.cloudChildId === cloudId)?.deviceId ?? cloudId,
    [liveChildren],
  )

  const pull = useCallback(async () => {
    if (!householdId.current) return
    try {
      const house = await loadHousehold(householdId.current)
      if (!house) return

      // Only children the account knows about. A cloud id with no row would be
      // an event stream with nothing to hang it on.
      const cloudIds = house.children.map((c) => c.id)
      if (cloudIds.length === 0) return

      // Children with no Bluetooth pairing need a local row before their events
      // mean anything. Ones that are paired already have theirs, and adding a
      // second would duplicate the child.
      const pairedCloudIds = new Set(
        liveChildren.map((c) => c.cloudChildId).filter((id): id is string => Boolean(id)),
      )
      dispatch({
        type: 'syncCloudChildren',
        children: house.children
          .filter((c) => !pairedCloudIds.has(c.id))
          .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar })),
      })

      const [events, usage] = await Promise.all([
        loadEventsForChildren(cloudIds).catch(() => []),
        loadUsageForChildren(cloudIds).catch(() => []),
      ])

      // Grouped per child because both ingest actions are per child, and the
      // reducer's de-duplication is scoped that way too.
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
          // Oldest first, matching the radio: the reducer prepends, so handing
          // it newest-first would leave the feed upside down.
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
      // Offline is the expected state for this product. The screens keep
      // whatever Bluetooth last gave them rather than emptying.
    }
  }, [dispatch, liveChildren, localIdFor])

  // Resolve the household once, then pull.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let cancelled = false
    void (async () => {
      const session = await currentSession()
      if (cancelled || !session) return
      householdId.current = await loadJSON<string | null>(HOUSEHOLD_KEY, null)
      if (householdId.current) await pull()
    })()
    return () => {
      cancelled = true
    }
  }, [role, pull])

  // Poll while on screen, paused otherwise. A parent's phone in a pocket
  // refreshing a history nobody is reading spends battery for nothing, and
  // coming back to the app triggers an immediate catch-up anyway.
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
