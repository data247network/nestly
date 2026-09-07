import { useEffect, useRef } from 'react'
import { hasCloud } from '../cloud/client'
import { sendParentCommand, pollChildCommands } from '../cloud/commands'
import { useStore } from './store'
import { useDevice } from '../platform/device'
import { useCloudChildren } from './CloudWatch'

/**
 * Cloud command transport for both sides of the product.
 *
 * Child: drains its authenticated command queue every five seconds and when
 * the app returns to the foreground.
 *
 * Parent: mirrors the existing Lock now / Unlock control into the durable
 * Supabase command queue. Bluetooth remains the fast local path elsewhere;
 * this bridge guarantees the same action can reach a child who is away.
 */
export function CloudCommandBridge() {
  const { role } = useDevice()

  if (role === 'child') return <ChildCommandPump />
  if (role === 'parent') return <ParentCommandBridge />
  return null
}

function ChildCommandPump() {
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    const poll = () => {
      if (!cancelled) void pollChildCommands().catch(() => {})
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll()
    }

    poll()
    timer = setInterval(poll, 5_000)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return null
}

function ParentCommandBridge() {
  const { state } = useStore()
  const { children: liveChildren } = useDevice()
  const { household } = useCloudChildren()
  const lastLock = useRef<boolean | null>(null)
  const sending = useRef(false)
  const lastAppRulesFingerprint = useRef<string | null>(null)

  const resolveCloudChildId = (localId: string | null) => {
    const remoteChildren = household?.children ?? []
    const directRemote = localId ? remoteChildren.find((c) => c.id === localId) : null
    const paired = liveChildren.find((c) => c.deviceId === localId && c.cloudChildId)
    const fallback = remoteChildren.length === 1 ? remoteChildren[0] : null
    return directRemote?.id ?? paired?.cloudChildId ?? fallback?.id ?? null
  }

  useEffect(() => {
    if (!hasCloud()) return
    if (lastLock.current === null) {
      // Do not issue an Unlock command just because the parent app started.
      lastLock.current = state.lockNow
      return
    }
    if (state.lockNow === lastLock.current || sending.current) return

    const desired = state.lockNow
    lastLock.current = desired

    const activeId = state.activeChildId ?? state.children[0]?.id ?? null
    const cloudChildId = resolveCloudChildId(activeId)

    if (!cloudChildId) return

    sending.current = true
    void sendParentCommand(cloudChildId, desired ? 'lock' : 'unlock')
      .catch(() => {})
      .finally(() => {
        sending.current = false
      })
  }, [state.lockNow, state.activeChildId, state.children, household, liveChildren])

  /**
   * Mirrors per-app caps/lock/PEGI into the durable command queue, the same
   * way Lock now / Unlock already reaches a child outside Bluetooth range.
   * Fingerprinted like `PolicyV2Bridge`'s resolved-policy check, so a parent
   * scrolling the app list does not fire a command queue insert per render.
   */
  useEffect(() => {
    if (!hasCloud()) return
    const fingerprint = JSON.stringify([state.appRules, state.maxPegi])
    if (lastAppRulesFingerprint.current === null) {
      // Do not issue a command just because the parent app started.
      lastAppRulesFingerprint.current = fingerprint
      return
    }
    if (fingerprint === lastAppRulesFingerprint.current) return
    lastAppRulesFingerprint.current = fingerprint

    const activeId = state.activeChildId ?? state.children[0]?.id ?? null
    const cloudChildId = resolveCloudChildId(activeId)
    if (!cloudChildId) return

    const rules = state.appRules.filter(
      (r) => r.childIds.length === 0 || (activeId != null && r.childIds.includes(activeId)),
    )
    void sendParentCommand(cloudChildId, 'apply_app_rules', {
      rules: rules.map((r) => ({ pkg: r.pkg, label: r.label, capMinutes: r.capMinutes, locked: r.locked })),
      ...(state.maxPegi != null ? { maxPegi: state.maxPegi } : {}),
    }).catch(() => {})
  }, [state.appRules, state.maxPegi, state.activeChildId, state.children, household, liveChildren])

  return null
}
