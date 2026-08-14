import { Network } from '@capacitor/network'
import { KEYS, loadJSON } from '../platform/storage'
import type { Note } from '../link/protocol'
import type { NoteChannel } from './notes'
import { ENDPOINT } from './cloudUplink'

/**
 * The child device's internet path for notes.
 *
 * The mirror of `cloud/notes.ts`, and it has to be a separate implementation
 * rather than a shared one: a child has no account and never signs in — that is
 * a deliberate property of the product — so it cannot touch the `notes` table
 * through RLS at all. Its only credential is the `device_secret` from enrolment
 * and its only door is `child-sync`, which authenticates with it.
 *
 * Every method resolves to nothing when the phone is not enrolled or has no
 * signal, which is the ordinary state rather than an error. Bluetooth carries
 * the note in the meantime, and the note stays queued either way.
 */

/**
 * How often the child asks whether a parent has left a note.
 *
 * Slower than the parent's 30s, and for a reason that only applies here: this
 * is a request from a child's phone with no push to wake it and no realtime
 * socket to lean on, so the interval *is* the battery cost. Telemetry runs at
 * 60s; a note landing in under a minute reads as immediate to the person
 * waiting for it, and paying for better would show up as a flat phone by
 * mid-afternoon.
 */
const POLL_MS = 45_000

type Enrolment = { childId?: string; deviceSecret?: string }

type SyncResponse = {
  notes?: { id: string; from: string; text: string; ts: number }[]
  noteDelivered?: string[]
}

/**
 * Posts to child-sync with the device secret, or resolves null.
 *
 * Network status is checked rather than the failure simply caught: a fetch on a
 * dead network can hang for its full timeout, and on a phone that is offline all
 * day that is a request left open every 45 seconds.
 */
async function post(body: Record<string, unknown>): Promise<SyncResponse | null> {
  const enrolment = await loadJSON<Enrolment | null>(KEYS.enrolment, null)
  if (!enrolment?.childId || !enrolment.deviceSecret) return null

  try {
    const status = await Network.getStatus()
    if (!status.connected) return null
  } catch {
    /* Network plugin unavailable off-device; fall through and just try. */
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      childId: enrolment.childId,
      deviceSecret: enrolment.deviceSecret,
      ...body,
    }),
  })
  if (!res.ok) return null
  return (await res.json().catch(() => ({}))) as SyncResponse
}

/**
 * The channel for this phone's own thread.
 *
 * Takes no child id: which child this device is belongs to the enrolment, read
 * fresh on every call. A phone is very often enrolled *after* its agent is
 * running, and caching the id at construction time would leave the notes screen
 * permanently offline on exactly the launch where a parent set it up.
 */
export function childNoteChannel(): NoteChannel {
  /**
   * Ids already acknowledged in this session.
   *
   * The server hands back recent notes rather than only unacknowledged ones, so
   * that a reinstalled phone recovers the thread instead of showing a child an
   * empty screen. Without this that choice would cost an extra request every
   * poll for the rest of the day, acknowledging notes the server already knows
   * arrived.
   */
  const acked = new Set<string>()

  return {
    pollMs: POLL_MS,

    async send(notes: Note[]): Promise<string[]> {
      if (notes.length === 0) return []
      const res = await post({ notes })
      // Null means not enrolled or not online. Reporting nothing stored keeps
      // the notes queued for the next attempt, and for Bluetooth meanwhile.
      return res ? notes.map((n) => n.id) : []
    },

    async poll(pendingIds: string[]) {
      const res = await post({ notePending: pendingIds.slice(0, 50), wantNotes: true })
      if (!res) return { incoming: [], delivered: [] }
      return {
        incoming: (res.notes ?? []).map((n) => ({
          id: n.id,
          from: n.from === 'parent' ? ('parent' as const) : ('child' as const),
          text: n.text,
          ts: n.ts,
        })),
        delivered: res.noteDelivered ?? [],
      }
    },

    async ack(ids: string[]) {
      const fresh = ids.filter((id) => !acked.has(id))
      if (fresh.length === 0) return
      const res = await post({ noteAcks: fresh.slice(0, 100) })
      // Only remembered once the server has actually been told. Marking them
      // acknowledged on a failed request would leave the parent's phone saying
      // "waiting" about a note their child has been reading for an hour.
      if (res) for (const id of fresh) acked.add(id)
    },
  }
}
