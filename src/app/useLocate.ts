import { useCallback, useEffect, useRef, useState } from 'react'
import { hasCloud } from '../cloud/client'
import { loadLocate, requestLocate as requestLocateCloud, subscribeToLocate } from '../cloud/sync'
import { useDevice } from '../platform/device'
import type { Fix } from '../link/protocol'

/**
 * "Where are they right now?"
 *
 * Locate used to open the map, which showed the last telemetry push — up to a
 * minute old on a good day, five under a low battery, and older still if the
 * phone had been asleep. That is a reasonable heartbeat and a poor answer to a
 * parent who has just tapped a button labelled Locate.
 *
 * So this asks, over both links at once, and reports honestly on the wait. The
 * two paths are not alternatives: the radio answers in a second when the phones
 * are in the same room and not at all otherwise, and the internet answers
 * whenever the child's phone next checks in, which is up to a minute. Asking on
 * both and taking whichever lands first is the only way to be quick when it is
 * possible and still work when it is not.
 */

export type LocateStatus =
  | { state: 'idle' }
  /** Asked, nothing back yet. */
  | { state: 'asking'; since: number }
  | { state: 'found'; fix: Fix; at: number }
  /** Asked and nothing came back — no signal, no fix, or the phone is off. */
  | { state: 'timeout' }
  | { state: 'unavailable'; reason: string }

/**
 * How long to wait before admitting nothing is coming.
 *
 * Generous on purpose. The child's phone polls the server about once a minute,
 * and then needs up to twelve seconds to take a reading — so anything under
 * ninety seconds would give up on requests that were about to be answered.
 */
const TIMEOUT_MS = 90_000

/** Under the realtime socket, in case it has quietly dropped. */
const POLL_MS = 5_000

export function useLocate(cloudChildId: string | null, peerId?: string) {
  const { requestLocate: askOverRadio, children: liveChildren } = useDevice()
  const [status, setStatus] = useState<LocateStatus>({ state: 'idle' })

  /** When the current request went out. Anything older is a previous answer. */
  const askedAt = useRef<number | null>(null)
  /** The Bluetooth fix at the moment of asking, so a *new* one is recognisable. */
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

    // Both, deliberately, and neither is awaited for the other's sake: a radio
    // that is not connected returns false immediately, and a cloud write that
    // fails must not stop the radio having already asked.
    const [radio, cloud] = await Promise.all([
      askOverRadio(peerId).catch(() => false),
      cloudChildId && hasCloud()
        ? requestLocateCloud(cloudChildId).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false),
    ])

    if (!radio && !cloud) {
      askedAt.current = null
      setStatus({
        state: 'unavailable',
        // Named rather than generic. "Could not ask" sends a parent to check
        // their child's phone when the problem is their own connection.
        reason: cloudChildId
          ? 'No connection, and their phone is not in Bluetooth range.'
          : "Their phone is not linked to your account yet, so this only works in Bluetooth range.",
      })
    }
  }, [askOverRadio, cloudChildId, peerId, liveChildren])

  // The radio's answer. It arrives as ordinary telemetry, so a *newer* fix
  // timestamp than the one held when we asked is what identifies it.
  useEffect(() => {
    if (askedAt.current == null) return
    const live = liveChildren.find((c) => (peerId ? c.deviceId === peerId : true))
    const fix = live?.telemetry?.fix
    if (fix && fix.ts > fixBefore.current) settle(fix)
  }, [liveChildren, peerId, settle])

  // The cloud's answer, pushed down the socket and polled underneath it.
  useEffect(() => {
    if (!cloudChildId || !hasCloud()) return

    let cancelled = false
    const check = async () => {
      if (cancelled || askedAt.current == null) return
      const state = await loadLocate(cloudChildId).catch(() => null)
      if (cancelled || !state || askedAt.current == null) return
      // Only an answer to *this* question. A served row from an hour ago is a
      // previous fix, and showing it as the reply to the tap just now would be
      // the exact staleness this whole path exists to remove.
      if (state.servedAt && state.requestedAt >= askedAt.current - 2000 && state.fix) {
        settle(state.fix)
      }
    }

    const stop = subscribeToLocate(cloudChildId, () => void check())
    const timer = setInterval(() => void check(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      stop()
    }
  }, [cloudChildId, settle])

  // Give up out loud rather than spinning for ever.
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
