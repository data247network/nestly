import { useEffect, useRef } from 'react'
import { useDevice } from '../platform/device'
import { buildPolicy, useStore } from './store'
import { CloudCommandBridge } from './CloudCommandBridge'

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

  return <CloudCommandBridge />
}
