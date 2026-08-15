import { useEffect, useRef, useState } from 'react'
import { hasCloud } from '../cloud/client'
import { pushEvents, pushPolicy, pushTelemetry, resolveHouseholdId } from '../cloud/sync'
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
  /**
   * State, not a ref.
   *
   * As a ref, becoming ready mutated nothing React could see, so the effect
   * below only re-ran if the policy happened to change again afterwards. A
   * parent who unlocked a phone before the session had resolved published that
   * unlock to Bluetooth and never to the server — and with the child out of
   * range, nothing else would ever send it.
   */
  const [ready, setReady] = useState(false)
  const lastPolicy = useRef(-1)

  // Resolve the household once per session. Without a signed-in user every
  // write would be refused by RLS, so this gates everything below.
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

  // Bind each paired phone to the child it says it was enrolled as.
  //
  // Binding only — this never creates a child. It used to, minting one from the
  // BLE pairing whenever a paired phone had no cloud row yet, and that was
  // wrong in a way that showed up on a real phone: a parent adds Eliora in
  // Family Hub, pairs the phone over Bluetooth, and the pairing lands first. A
  // second Eliora appears with no device against it, counting towards the
  // plan's child limit, and the enrolment three minutes later attaches to the
  // original. Two rows, one child.
  //
  // The account decides who a child is; Bluetooth is only how their phone is
  // reached. So a phone that has not been enrolled simply is not mirrored — the
  // local product is untouched, and Family Hub already says "No phone linked
  // yet", which is the truth rather than a duplicate pretending otherwise.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    // The stored binding first: it survives the phones being apart, which is
    // most of the time. The live one then confirms or updates it.
    for (const pairing of pairings) {
      if (pairing.cloudChildId) childIds.current.set(pairing.peerId, pairing.cloudChildId)
    }
    for (const child of liveChildren) {
      if (child.cloudChildId) childIds.current.set(child.deviceId, child.cloudChildId)
    }
  }, [role, liveChildren, pairings])

  // Policy up, whenever the version the child enforces changes.
  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    if (!ready || !householdId.current) return
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
  }, [role, ready, state, pairings])

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
