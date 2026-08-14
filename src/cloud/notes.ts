import { hasCloud, supabase } from './client'
import type { Note } from '../link/protocol'
import type { NoteChannel } from '../agent/notes'

/**
 * The parent's internet path for notes.
 *
 * The signed-in half of the pair: a parent writes to `notes` through RLS, which
 * already scopes every row to the households they belong to. The child's half
 * looks nothing like this — no account, no session — and goes through the
 * `child-sync` edge function instead; `agent/cloudNotes.ts` is that side.
 *
 * Realtime carries a note across in about a second. The poll underneath it is
 * not redundant: a websocket that drops when a phone changes network reconnects
 * silently, and a messaging screen that has quietly stopped receiving is worse
 * than one that is merely slow.
 */

/** Recent enough that a phone off all weekend still catches up. */
const WINDOW_DAYS = 14
const MAX_INCOMING = 50

/**
 * Realtime does the work, so this only has to catch a dropped socket.
 * Deliberately slower than the 15s used for telemetry — a note is written by a
 * person every few minutes at most, not sampled by a device every tick.
 */
const POLL_MS = 30_000

type NoteRow = { client_id: string; sender: string; body: string; ts: string }

function toNote(r: NoteRow): Note {
  return {
    id: r.client_id,
    from: r.sender === 'parent' ? 'parent' : 'child',
    text: r.body,
    // Back to epoch milliseconds, which is what the thread sorts on.
    ts: new Date(r.ts).getTime(),
  }
}

export function parentNoteChannel(childId: string): NoteChannel {
  /**
   * Ids already acknowledged in this session.
   *
   * The poll returns recent notes rather than only undelivered ones, because
   * filtering on `delivered_at` would mean the first adult to open the app is
   * the only one who ever sees a note — the second parent's poll would skip it
   * for ever. This is what keeps that choice from costing a write every cycle.
   */
  const acked = new Set<string>()

  return {
    pollMs: POLL_MS,

    async send(notes: Note[]): Promise<string[]> {
      if (!hasCloud() || notes.length === 0) return []
      const { data: session } = await supabase().auth.getSession()
      const userId = session.session?.user.id ?? null

      const { error } = await supabase()
        .from('notes')
        .upsert(
          notes.map((n) => ({
            child_id: childId,
            client_id: n.id,
            sender: n.from,
            sender_user_id: userId,
            body: n.text,
            ts: new Date(n.ts).toISOString(),
          })),
          { onConflict: 'client_id', ignoreDuplicates: true },
        )
      if (error) throw error

      // Every id, not just the newly inserted ones. `ignoreDuplicates` returns
      // nothing for a row that was already there, and a resend is the normal
      // case — treating that as a failure would re-upload the same note for the
      // rest of the thread's life.
      return notes.map((n) => n.id)
    },

    async poll(pendingIds: string[]) {
      if (!hasCloud()) return { incoming: [], delivered: [] }
      const db = supabase()
      const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

      const [{ data: rows, error }, receipts] = await Promise.all([
        db
          .from('notes')
          .select('client_id, sender, body, ts')
          .eq('child_id', childId)
          .eq('sender', 'child')
          .gte('ts', since)
          .order('ts', { ascending: true })
          .limit(MAX_INCOMING),
        // Skipped entirely with an empty backlog: `in.()` is both a wasted round
        // trip and a query PostgREST would rather not be handed.
        pendingIds.length > 0
          ? db
              .from('notes')
              .select('client_id')
              .eq('child_id', childId)
              .in('client_id', pendingIds)
              .not('delivered_at', 'is', null)
          : Promise.resolve({ data: [] as { client_id: string }[] }),
      ])
      if (error) throw error

      return {
        incoming: (rows ?? []).map((r) => toNote(r as NoteRow)),
        delivered: (receipts.data ?? []).map((r) => r.client_id as string),
      }
    },

    async ack(ids: string[]) {
      if (!hasCloud()) return
      const fresh = ids.filter((id) => !acked.has(id))
      if (fresh.length === 0) return
      for (const id of fresh) acked.add(id)

      // Guarded on null so the first receipt is the one that counts. Without it
      // a second parent opening the app would rewrite the timestamp to now and
      // the child's "delivered" would drift later every day.
      await supabase()
        .from('notes')
        .update({ delivered_at: new Date().toISOString() })
        .eq('child_id', childId)
        .in('client_id', fresh)
        .is('delivered_at', null)
    },

    subscribe(onChange: () => void) {
      if (!hasCloud()) return () => {}
      const db = supabase()
      const channel = db
        .channel(`notes-${childId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notes', filter: `child_id=eq.${childId}` },
          () => onChange(),
        )
      channel.subscribe()
      return () => {
        void db.removeChannel(channel)
      }
    },
  }
}
