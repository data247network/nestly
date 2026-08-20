import { useCallback, useEffect, useRef } from 'react'
import { hasCloud } from '../cloud/client'
import { resolveHouseholdId } from '../cloud/sync'
import { loadCloudRoster } from '../cloud/roster'
import { parentNoteChannel } from '../cloud/notes'
import type { NoteChannel } from '../agent/notes'
import { useDevice } from '../platform/device'

/**
 * Gives the parent's notes an internet path without depending on the full
 * dashboard query. Notes are a communication channel, so an unrelated
 * telemetry/aggregate query must never prevent them from being addressed.
 */
const ROSTER_MS = 15_000

export function NotesBridge() {
  const { role, children: liveChildren, pairings, setNoteChannel, setCloudChildren } = useDevice()
  const householdId = useRef<string | null>(null)
  const channels = useRef(new Map<string, NoteChannel>())

  const channelFor = useCallback((cloudId: string): NoteChannel => {
    const existing = channels.current.get(cloudId)
    if (existing) return existing
    const made = parentNoteChannel(cloudId)
    channels.current.set(cloudId, made)
    return made
  }, [])

  const sync = useCallback(async () => {
    if (!householdId.current) return
    try {
      // Use the isolated roster query. The old implementation called
      // loadHousehold(), which also embeds telemetry and counts members. If
      // any unrelated dashboard relation failed, the Notes bridge silently
      // created no internet channel and a parent note for Eliora stayed local.
      const roster = await loadCloudRoster(householdId.current)

      const pairedCloudIds = new Set<string>()
      const bind = (localId: string, cloudId: string) => {
        pairedCloudIds.add(cloudId)
        setNoteChannel(localId, channelFor(cloudId))
      }

      for (const pairing of pairings) {
        if (pairing.cloudChildId) bind(pairing.peerId, pairing.cloudChildId)
      }
      for (const child of liveChildren) {
        if (child.cloudChildId) bind(child.deviceId, child.cloudChildId)
      }

      const unpaired = roster.filter((c) => !pairedCloudIds.has(c.id))
      await setCloudChildren(unpaired.map((c) => ({ id: c.id, name: c.name })))
      for (const child of unpaired) setNoteChannel(child.id, channelFor(child.id))

      const known = new Set(roster.map((c) => c.id))
      for (const id of [...channels.current.keys()]) {
        if (!known.has(id)) channels.current.delete(id)
      }
    } catch {
      // Retry shortly. Existing Bluetooth notes remain usable meanwhile.
    }
  }, [liveChildren, pairings, setNoteChannel, setCloudChildren, channelFor])

  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    let cancelled = false
    void (async () => {
      const id = await resolveHouseholdId().catch(() => null)
      if (cancelled || !id) return
      householdId.current = id
      await sync()
    })()
    return () => {
      cancelled = true
    }
  }, [role, sync])

  useEffect(() => {
    if (!hasCloud() || role !== 'parent') return
    const timer = setInterval(() => void sync(), ROSTER_MS)
    return () => clearInterval(timer)
  }, [role, sync])

  return null
}
