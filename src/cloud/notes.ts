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

const WINDOW_DAYS = 14
const MAX_INCOMING = 50
const POLL_MS = 30_000

let channelSequence = 0
function uniqueChannelName(childId: string): string {
  channelSequence += 1
  return `notes-${childId}-${Date.now()}-${channelSequence}`
}

type NoteRow = { client_id: string; sender: string; body: string; ts: string }

function toNote(r: NoteRow): Note {
  return {
    id: r.client_id,
    from: r.sender === 'parent' ? 'parent' : 'child',
    text: r.body,
    ts: new Date(r.ts).getTime(),
  }
}

export function parentNoteChannel(childId: string): NoteChannel {
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
        .channel(uniqueChannelName(childId))
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notes', filter: `child_id=eq.${childId}` },
          () => onChange(),
        )
      channel.subscribe()

      let removed = false
      return () => {
        if (removed) return
        removed = true
        void db.removeChannel(channel)
      }
    },
  }
}
