import { useCallback, useEffect, useRef } from 'react'
import { hasCloud } from '../cloud/client'
import { loadHousehold, resolveHouseholdId } from '../cloud/sync'
import { parentNoteChannel } from '../cloud/notes'
import type { NoteChannel } from '../agent/notes'
import { useDevice } from '../platform/device'

/**
 * Gives the parent's notes an internet path.
 *
 * Notes were the last part of Nestly that could only cross when the two phones
 * were in the same room. Location, events, usage and policy had all moved to
 * the cloud; a note left for a child at school still sat in a queue until they
 * walked back through the door, which is the opposite of what anyone would
 * expect from a message.
 *
 * This component exists rather than the wiring living in `platform/device.tsx`
 * because that file is the offline core and deliberately does not import the
 * cloud client. The child's side needs no equivalent — it authenticates with a
 * device secret against one edge function and builds its own channel.
 *
 * Two jobs, and the second is the one that is easy to miss:
 *
 *   - Bind each *paired* phone to the cloud child it was enrolled as, so one
 *     child does not end up with two threads, one per link.
 *   - Give children who were enrolled online but never paired over Bluetooth a
 *     thread at all. That is now the ordinary setup, and without it the Notes
 *     screen is permanently empty for a family whose account is complete.
 */

/**
 * How often the household roster is re-read.
 *
 * Slow on purpose: this is watching for a child being added or enrolled, which
 * happens a few times in the life of a family. The notes themselves arrive over
 * realtime and each thread's own poll — nothing here is on that path.
 */
const ROSTER_MS = 60_000

export function NotesBridge() {
  const { role, children: liveChildren, setNoteChannel, setCloudChildren } = useDevice()
  const householdId = useRef<string | null>(null)
  /**
   * One channel per cloud child, reused.
   *
   * Rebuilding it on every render would tear down and re-open a realtime
   * subscription each time, which reads as a notes screen that intermittently
   * stops updating.
   */
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
      const house = await loadHousehold(householdId.current)
      if (!house) return

      // Which pairing is which child, straight from the child's own Hello. The
      // account decides who a child is; Bluetooth is only how their phone is
      // reached, so an unenrolled pairing simply has no cloud thread.
      const pairedCloudIds = new Set<string>()
      for (const child of liveChildren) {
        if (!child.cloudChildId) continue
        pairedCloudIds.add(child.cloudChildId)
        setNoteChannel(child.deviceId, channelFor(child.cloudChildId))
      }

      const unpaired = house.children.filter((c) => !pairedCloudIds.has(c.id))
      await setCloudChildren(unpaired.map((c) => ({ id: c.id, name: c.name })))
      for (const child of unpaired) setNoteChannel(child.id, channelFor(child.id))

      // Drop channels for children who have left the account, so their realtime
      // subscription goes with them.
      const known = new Set(house.children.map((c) => c.id))
      for (const id of [...channels.current.keys()]) {
        if (!known.has(id)) channels.current.delete(id)
      }
    } catch {
      // Offline, or signed out. The threads keep whatever Bluetooth gave them
      // and pick the internet back up on the next pass.
    }
  }, [liveChildren, setNoteChannel, setCloudChildren, channelFor])

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
