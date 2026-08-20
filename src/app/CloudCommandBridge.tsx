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
    const remoteChildren = household?.children ?? []
    const directRemote = activeId ? remoteChildren.find((c) => c.id === activeId) : null
    const paired = liveChildren.find((c) => c.deviceId === activeId && c.cloudChildId)
    const fallback = remoteChildren.length === 1 ? remoteChildren[0] : null
    const cloudChildId = directRemote?.id ?? paired?.cloudChildId ?? fallback?.id ?? null

    if (!cloudChildId) return

    sending.current = true
    void sendParentCommand(cloudChildId, desired ? 'lock' : 'unlock')
      .catch(() => {})
      .finally(() => {
        sending.current = false
      })
  }, [state.lockNow, state.activeChildId, state.children, household, liveChildren])

  return null
}
