import { Network } from '@capacitor/network'
import { KEYS, loadJSON } from '../platform/storage'
import type { Note } from '../link/protocol'
import type { NoteChannel } from './notes'
import { ENDPOINT } from './cloudUplink'

/** Child-side internet path for the notes thread. */
const POLL_MS = 15_000

type Enrolment = { childId?: string; deviceSecret?: string }
type SyncResponse = {
  notes?: { id: string; from: string; text: string; ts: number }[]
  noteDelivered?: string[]
  error?: string
}

async function post(body: Record<string, unknown>): Promise<SyncResponse | null> {
  const enrolment = await loadJSON<Enrolment | null>(KEYS.enrolment, null)
  if (!enrolment?.childId || !enrolment.deviceSecret) return null

  try {
    const status = await Network.getStatus()
    if (!status.connected) return null
  } catch {
    // Native network plugin unavailable: let fetch decide.
  }

  try {
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
  } catch {
    return null
  }
}

/**
 * The child polls for parent notes. The queue remains local until the server
 * confirms receipt, while Bluetooth can still deliver the same note offline.
 */
export function childNoteChannel(): NoteChannel {
  const acked = new Set<string>()

  return {
    pollMs: POLL_MS,

    async send(notes: Note[]): Promise<string[]> {
      if (notes.length === 0) return []
      const res = await post({ notes })
      // Only acknowledge locally after the Edge Function returned a response.
      // A network failure therefore leaves the note queued for the next cycle.
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
      if (res) for (const id of fresh) acked.add(id)
    },
  }
}
