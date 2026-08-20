import { useEffect, useRef, useState } from 'react'
import { hasCloud } from '../cloud/client'
import { loadHousehold, pushEvents, pushPolicy, pushTelemetry, resolveHouseholdId } from '../cloud/sync'
import { useDevice } from '../platform/device'
import { buildPolicy, useStore } from './store'

/**
 * Cloud is the primary remote path. Bluetooth is the local/offline fallback.
 *
 * This bridge mirrors telemetry/events upward and publishes parent policy
 * downward. Policy must target every enrolled cloud child, not only children
 * that happen to be paired over Bluetooth.
 */
export function CloudBridge() {
  const { role, children: liveChildren, onChildEvents, pairings } = useDevice()
  const { state } = useStore()
  const childIds = useRef(new Map<string, string>())
  const householdId = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [cloudChildIds, setCloudChildIds] = useState<string[]>([])
  const lastPolicy = useRef(-1)

  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let cancelled = false
    void (async () => {
      const id = await resolveHouseholdId().catch(() => null)
      if (cancelled) return
      householdId.current = id
      setReady(id != null)
    })()
    return () => {
      cancelled = true
    }
  }, [role])

  // Keep the remote roster independent of Bluetooth. This is what allows a
  // child enrolled from the web to receive policy changes even if the parent
  // has never paired the two radios.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent' || !householdId.current) return
    let cancelled = false
    const refresh = async () => {
      try {
        const house = await loadHousehold(householdId.current!)
        if (!cancelled && house) {
          const ids = house.children.map((c) => c.id)
          setCloudChildIds((current) => current.join(',') === ids.join(',') ? current : ids)
        }
      } catch {
        // Retry on the next interval; local/Bluetooth behaviour is unaffected.
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [role, ready])

  // Bind paired phones to their enrolled cloud child id.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    for (const pairing of pairings) {
      if (pairing.cloudChildId) childIds.current.set(pairing.peerId, pairing.cloudChildId)
    }
    for (const child of liveChildren) {
      if (child.cloudChildId) childIds.current.set(child.deviceId, child.cloudChildId)
    }
  }, [role, liveChildren, pairings])

  // Cloud policy is authoritative for remote children. PolicyBridge continues
  // to push the same policy over BLE when a child is physically nearby.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    if (!ready || !householdId.current) return
    if (state.policyVersion === lastPolicy.current) return
    lastPolicy.current = state.policyVersion

    const targets = new Set<string>(cloudChildIds)
    for (const pairing of pairings) {
      const cloudId = childIds.current.get(pairing.peerId)
      if (cloudId) targets.add(cloudId)
    }

    void Promise.all(
      [...targets].map(async (cloudId) => {
        try {
          await pushPolicy(householdId.current!, cloudId, buildPolicy(state, cloudId))
        } catch {
          // A later policy change or roster refresh will retry the cloud copy.
        }
      }),
    )
  }, [role, ready, state.policyVersion, cloudChildIds, pairings])

  // Events up, as they arrive from a paired child device.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    return onChildEvents((peerId, events) => {
      const cloudId = childIds.current.get(peerId)
      if (!cloudId || events.length === 0) return
      void pushEvents(cloudId, events).catch(() => {})
    })
  }, [role, onChildEvents])

  // Telemetry up from paired children. Children that are not paired use their
  // own child-agent cloud uploader and therefore do not depend on this bridge.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    for (const child of liveChildren) {
      const cloudId = childIds.current.get(child.deviceId)
      if (!cloudId || !child.telemetry) continue
      void pushTelemetry(cloudId, child.telemetry).catch(() => {})
    }
  }, [role, liveChildren])

  return null
}
