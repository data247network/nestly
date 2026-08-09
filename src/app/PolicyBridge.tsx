import { useEffect, useRef } from 'react'
import { useDevice } from '../platform/device'
import { buildPolicy, useStore } from './store'

/**
 * Joins the parent's rules to every paired child device.
 *
 * Two directions, both one-way:
 *   rules  -> policy pushed down to all children whenever the version changes
 *   events -> alerts, status and usage pulled up, tagged with the child they
 *             came from
 *
 * Kept as a component with no output so the wiring lives in one place instead
 * of being scattered through the screens that happen to trigger it.
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

  // Unpairing clears that child's card, alerts, zones and history. Scoped to the
  // device that went, so the other children keep theirs.
  useEffect(() => {
    const ids = pairings.map((p) => p.peerId)
    for (const gone of knownPairings.current.filter((id) => !ids.includes(id))) {
      dispatch({ type: 'forgetChild', childId: gone })
    }
    knownPairings.current = ids
  }, [pairings, dispatch])

  /**
   * Prune children that no pairing accounts for.
   *
   * Children are persisted, so an install upgraded from a build that keyed them
   * differently carries a ghost card that no unpair can ever clear — it showed
   * up as a second child on Home with the placeholder name and a copy of the
   * real one's battery.
   *
   * Guarded on `ready`: pairings load asynchronously, and running this against
   * the empty initial list would wipe every legitimate child on each launch.
   *
   * `children.length` is a dependency because the store hydrates from disk
   * independently — without it the ghost is restored *after* this has already
   * run, and nothing would trigger it again until the pairings changed.
   */
  useEffect(() => {
    if (!ready || role !== 'parent') return
    dispatch({ type: 'reconcileChildren', validIds: pairings.map((p) => p.peerId) })
  }, [ready, role, pairings, state.children.length, dispatch])

  // Rules down. Pushed when the version changes, and again the moment any child
  // link comes up — a child that was out of range for the last change needs it
  // on reconnect. Re-sending the same version is harmless: the child adopts a
  // policy at or above its own and the payload is identical.
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

  // Child status up — one dispatch per child that has reported.
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

  // Events up.
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

  // Usage + browsing up.
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

  return null
}
