import { useCallback, useEffect, useRef, useState } from 'react'
import { hasCloud } from '../cloud/client'
import { loadLocate, requestLocate as requestLocateCloud } from '../cloud/sync'
import { subscribeToLocateSafe } from '../cloud/realtime'
import { useDevice } from '../platform/device'
import type { Fix } from '../link/protocol'

export type LocateStatus =
  | { state: 'idle' }
  | { state: 'asking'; since: number }
  | { state: 'found'; fix: Fix; at: number }
  | { state: 'timeout' }
  | { state: 'unavailable'; reason: string }

const TIMEOUT_MS = 90_000
const POLL_MS = 5_000

export function useLocate(cloudChildId: string | null, peerId?: string) {
  const { requestLocate: askOverRadio, children: liveChildren } = useDevice()
  const [status, setStatus] = useState<LocateStatus>({ state: 'idle' })
  const askedAt = useRef<number | null>(null)
  const fixBefore = useRef<number>(0)

  const settle = useCallback((fix: Fix) => {
    askedAt.current = null
    setStatus({ state: 'found', fix, at: Date.now() })
  }, [])

  const ask = useCallback(async () => {
    const now = Date.now()
    askedAt.current = now
    fixBefore.current =
      liveChildren.find((c) => (peerId ? c.deviceId === peerId : true))?.telemetry?.fix?.ts ?? 0
    setStatus({ state: 'asking', since: now })

    const [radio, cloud] = await Promise.all([
      askOverRadio(peerId).catch(() => false),
      cloudChildId && hasCloud()
        ? requestLocateCloud(cloudChildId).then(() => true, () => false)
        : Promise.resolve(false),
    ])

    if (!radio && !cloud) {
      askedAt.current = null
      setStatus({
        state: 'unavailable',
        reason: cloudChildId
          ? 'No connection, and their phone is not in Bluetooth range.'
          : "Their phone is not linked to your account yet, so this only works in Bluetooth range.",
      })
    }
  }, [askOverRadio, cloudChildId, peerId, liveChildren])

  useEffect(() => {
    if (askedAt.current == null) return
    const live = liveChildren.find((c) => (peerId ? c.deviceId === peerId : true))
    const fix = live?.telemetry?.fix
    if (fix && fix.ts > fixBefore.current) settle(fix)
  }, [liveChildren, peerId, settle])

  useEffect(() => {
    if (!cloudChildId || !hasCloud()) return

    let cancelled = false
    const check = async () => {
      if (cancelled || askedAt.current == null) return
      const state = await loadLocate(cloudChildId).catch(() => null)
      if (cancelled || !state || askedAt.current == null) return
      if (state.servedAt && state.requestedAt >= askedAt.current - 2000 && state.fix) {
        settle(state.fix)
      }
    }

    const stop = subscribeToLocateSafe(cloudChildId, () => void check())
    const timer = setInterval(() => void check(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      stop()
    }
  }, [cloudChildId, settle])

  useEffect(() => {
    if (status.state !== 'asking') return
    const timer = setTimeout(() => {
      askedAt.current = null
      setStatus({ state: 'timeout' })
    }, TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [status])

  const reset = useCallback(() => {
    askedAt.current = null
    setStatus({ state: 'idle' })
  }, [])

  return { status, ask, reset }
}
