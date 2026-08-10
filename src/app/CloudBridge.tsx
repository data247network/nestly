import { useEffect, useRef } from 'react'
import { hasCloud } from '../cloud/client'
import { currentSession, pushEvents, pushPolicy, pushTelemetry, upsertChild } from '../cloud/sync'
import { HOUSEHOLD_KEY } from '../screens/login'
import { loadJSON } from '../platform/storage'
import { useDevice } from '../platform/device'
import { buildPolicy, useStore } from './store'

/**
 * Mirrors the Bluetooth link to the cloud.
 *
 * Strictly one-way and strictly additive: Bluetooth remains the source of
 * truth, and this copies what already happened up to Supabase so a parent can
 * see it from somewhere else later. Nothing here can fail in a way that affects
 * the phones — every call is wrapped, because a network error must never stop a
 * routine running or an event being logged locally.
 *
 * Deliberately separate from PolicyBridge rather than folded into it. That
 * component is the thing that makes the product work offline; keeping cloud
 * concerns out of it means a mistake here cannot break the offline path.
 */
export function CloudBridge() {
  const { role, children: liveChildren, onChildEvents, pairings } = useDevice()
  const { state } = useStore()

  /** Supabase child uuid, keyed by the BLE pairing id the app uses. */
  const childIds = useRef(new Map<string, string>())
  const householdId = useRef<string | null>(null)
  const ready = useRef(false)
  const lastPolicy = useRef(-1)

  // Resolve the household once per session. Without a signed-in user every
  // write would be refused by RLS, so this gates everything below.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let cancelled = false
    void (async () => {
      const session = await currentSession()
      if (cancelled || !session) return
      householdId.current = await loadJSON<string | null>(HOUSEHOLD_KEY, null)
      ready.current = householdId.current != null
    })()
    return () => {
      cancelled = true
    }
  }, [role])

  // Register each paired child, so events have something to hang off.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let cancelled = false

    void (async () => {
      if (!ready.current || !householdId.current) return
      for (const p of pairings) {
        if (cancelled || childIds.current.has(p.peerId)) continue
        const local = state.children.find((c) => c.id === p.peerId)
        try {
          const id = await upsertChild(householdId.current, {
            peerId: p.peerId,
            name: local?.name ?? p.peerName,
            avatar: local?.avatar ?? '#147D77',
          })
          if (id) childIds.current.set(p.peerId, id)
        } catch {
          // Offline, or RLS refused. Retried on the next render that matters.
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [role, pairings, state.children])

  // Policy up, whenever the version the child enforces changes.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    if (!ready.current || !householdId.current) return
    if (state.policyVersion === lastPolicy.current) return
    lastPolicy.current = state.policyVersion

    void (async () => {
      for (const p of pairings) {
        const cloudId = childIds.current.get(p.peerId) ?? null
        try {
          await pushPolicy(householdId.current!, cloudId, buildPolicy(state, p.peerId))
        } catch {
          /* the phones already have it; the cloud copy catches up later */
        }
      }
    })()
  }, [role, state, pairings])

  // Events up, as they arrive from the child device.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    return onChildEvents((peerId, events) => {
      const cloudId = childIds.current.get(peerId)
      if (!cloudId || events.length === 0) return
      void pushEvents(cloudId, events).catch(() => {})
    })
  }, [role, onChildEvents])

  // Telemetry up. Latest-only, so a missed one is simply superseded.
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
