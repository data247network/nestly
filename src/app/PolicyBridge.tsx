import { useEffect, useRef } from 'react'
import { useDevice } from '../platform/device'
import { buildPolicy, useStore } from './store'
import { CloudCommandBridge } from './CloudCommandBridge'
import { hasCloud, supabase } from '../cloud/client'
import { resolveHouseholdId } from '../cloud/sync'
import type { Geofence } from './types'
import type { Pairing } from '../platform/device'

/**
 * Joins the parent's rules to every paired child device.
 *
 * Two directions, both one-way:
 *   rules  -> policy pushed down to all children whenever the version changes
 *   events -> alerts, status and usage pulled up, tagged with the child they
 *             came from
 *
 * CloudCommandBridge is mounted here as well so the parent's existing Lock now
 * / Unlock control is mirrored into the durable cloud command queue without
 * changing the screen-level interaction.
 */
export function PolicyBridge() {
  const {
    ready,
    role,
    children: liveChildren,
    pushPolicy,
    onChildEvents,
    onChildUsage,
    linkByChild,
    pairings,
  } = useDevice()
  const { state, dispatch } = useStore()
  const lastPushed = useRef(-1)
  const connectedSet = useRef(new Set<string>())
  const knownPairings = useRef<string[]>([])

  useEffect(() => {
    const ids = pairings.map((p) => p.peerId)
    for (const gone of knownPairings.current.filter((id) => !ids.includes(id))) {
      dispatch({ type: 'forgetChild', childId: gone })
    }
    knownPairings.current = ids
  }, [pairings, dispatch])

  useEffect(() => {
    if (!ready || role !== 'parent') return
    dispatch({ type: 'reconcileChildren', validIds: pairings.map((p) => p.peerId) })
  }, [ready, role, pairings, state.children.length, dispatch])

  useEffect(() => {
    if (role !== 'parent') return

    let justConnected = false
    for (const [peerId, status] of Object.entries(linkByChild)) {
      const was = connectedSet.current.has(peerId)
      const now = status.state === 'connected'
      if (now && !was) justConnected = true
      if (now) connectedSet.current.add(peerId)
      else connectedSet.current.delete(peerId)
    }

    if (!justConnected && state.policyVersion === lastPushed.current) return
    lastPushed.current = state.policyVersion
    void pushPolicy((childId) => buildPolicy(state, childId))
  }, [role, state, pushPolicy, linkByChild])

  useEffect(() => {
    if (role !== 'parent') return
    for (const child of liveChildren) {
      dispatch({
        type: 'childSeen',
        child: { deviceId: child.deviceId, name: child.name },
        battery: child.telemetry?.battery ?? null,
        locked: child.telemetry?.locked ?? false,
        activeScenarioId: child.telemetry?.activeScenarioId ?? null,
        hasFix: child.telemetry?.fix != null,
      })
    }
  }, [role, liveChildren, dispatch])

  useEffect(() => {
    if (role !== 'parent') return
    return onChildEvents((childId, events) => {
      dispatch({
        type: 'ingestEvents',
        childId,
        events: events.map((e) => ({
          seq: e.seq,
          ts: e.ts,
          kind: e.kind,
          ref: e.ref,
          cat: e.cat,
        })),
      })
    })
  }, [role, onChildEvents, dispatch])

  useEffect(() => {
    if (role !== 'parent') return
    return onChildUsage((childId, report) => {
      dispatch({
        type: 'ingestUsage',
        childId,
        day: report.day,
        apps: report.apps,
        sites: report.sites,
        usageAccess: report.usageAccess,
        filterOn: report.filterOn,
      })
    })
  }, [role, onChildUsage, dispatch])

  /**
   * Mirrors the parent's local geofences into `safe_zones`, so Architecture
   * v2's location tables stop being dead — without building a second,
   * duplicate zones screen. Geofencing itself (evaluation, alerts, the map
   * editor) stays entirely on the proven Bluetooth path; this only feeds the
   * v2 tables from the same data, debounced so a parent dragging a radius
   * slider does not fire a write per pixel.
   */
  useEffect(() => {
    if (role !== 'parent' || !hasCloud()) return
    const timer = window.setTimeout(() => {
      void syncSafeZones(state.geofences, pairings)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [role, state.geofences, pairings])

  return <CloudCommandBridge />
}

async function syncSafeZones(geofences: Geofence[], pairings: Pairing[]) {
  const householdId = await resolveHouseholdId()
  if (!householdId) return
  const db = supabase()

  const { data: existing, error: readError } = await db
    .from('safe_zones')
    .select('id, name, active')
    .eq('household_id', householdId)
  if (readError) {
    console.error('safe_zones: could not read existing zones', readError)
    return
  }
  const byName = new Map((existing ?? []).map((row) => [String(row.name), row as { id: string; active: boolean }]))
  const liveNames = new Set(geofences.map((f) => f.name))

  for (const fence of geofences) {
    // Local ids are Bluetooth peer ids; safe_zones wants the cloud child uuid,
    // the same binding CloudCommandBridge already relies on. An id with no
    // binding yet is dropped rather than guessed at.
    const childIds = fence.childIds
      .map((id) => pairings.find((p) => p.peerId === id)?.cloudChildId)
      .filter((id): id is string => Boolean(id))
    const payload = {
      household_id: householdId,
      name: fence.name,
      latitude: fence.lat,
      longitude: fence.lng,
      radius_m: Math.round(fence.radiusM),
      active: true,
      child_ids: childIds,
    }
    const row = byName.get(fence.name)
    const { error } = row
      ? await db.from('safe_zones').update(payload).eq('id', row.id)
      : await db.from('safe_zones').insert(payload)
    if (error) console.error('safe_zones: sync failed for', fence.name, error)
  }

  // A zone removed locally is soft-deleted server-side, matching the column
  // the dashboard reader already filters on, rather than deleted outright.
  for (const row of existing ?? []) {
    if (row.active && !liveNames.has(String(row.name))) {
      const { error } = await db.from('safe_zones').update({ active: false }).eq('id', row.id)
      if (error) console.error('safe_zones: could not retire', row.name, error)
    }
  }
}
