import type { Message, Note } from '../link/protocol'
import type { Transport } from '../link/transport'
import { loadJSON, saveJSON } from '../platform/storage'

/**
 * Two-way notes between the paired phones.
 *
 * A note travels over **two** links now: the internet first, Bluetooth as the
 * fallback. That ordering is the product decision — a note that can only cross
 * when the two phones are in the same room is a note you did not need to send,
 * and it was the last part of Nestly still working that way while location,
 * events, usage and policy had all moved to the cloud.
 *
 * Neither link is trusted to be there. The same store-and-forward discipline as
 * the event log applies to both: a note is queued locally, retried on every
 * opportunity, and only marked delivered when the *other side* says it has
 * stored it. The UI shows that state rather than a hopeful tick.
 *
 * The two links cannot duplicate each other because a note carries the id its
 * author minted, and both paths de-duplicate on it — exactly how `seq` keeps
 * events single when they arrive over the radio and the wire at once.
 *
 * Runs identically on both devices — there is no asymmetry in leaving a note.
 */

export type NoteState = Note & {
  /** The other side has it. The only claim the UI is allowed to make. */
  delivered: boolean
  /**
   * The server has it.
   *
   * Deliberately distinct from `delivered`: a note sitting safely in Postgres
   * has still not reached anybody if the other phone has been in a bag all
   * afternoon. This exists to stop re-uploading, not to tell a parent anything.
   */
  synced?: boolean
}

/**
 * The internet path for a thread of notes.
 *
 * An interface rather than a direct Supabase call because the two ends reach
 * the server completely differently: a parent is signed in and writes through
 * RLS, a child has no account and goes through the `child-sync` edge function
 * with its device secret. Both shapes reduce to send / poll / ack, and NoteBox
 * does not need to know which it has — which also keeps the cloud client out of
 * the offline core.
 */
export type NoteChannel = {
  /** Uploads notes. Resolves with the ids the server durably stored. */
  send(notes: Note[]): Promise<string[]>
  /**
   * Reads the other side's undelivered notes, and reports which of `pendingIds`
   * they have since acknowledged.
   *
   * Bounded by `pendingIds` on purpose: "which of these specific notes landed"
   * stays the same size as the backlog, where "every note I ever sent" grows
   * without limit for the life of the family.
   */
  poll(pendingIds: string[]): Promise<{ incoming: Note[]; delivered: string[] }>
  /** Confirms this device holds them, so the sender can stop saying "waiting". */
  ack(ids: string[]): Promise<void>
  /** Fires when the server has something new, where the transport can tell. */
  subscribe?(onChange: () => void): () => void
  /** How often to poll when nothing pushes. Paced by the caller, not here. */
  pollMs?: number
}

const MAX_NOTES = 200
/** Safe default when a channel does not pace itself. */
const DEFAULT_POLL_MS = 20_000

export class NoteBox {
  private notes: NoteState[] = []
  private subs = new Set<(n: NoteState[]) => void>()
  private unsubscribe?: () => void
  private cloud: NoteChannel | null = null
  private unwatchCloud?: () => void
  private poller?: ReturnType<typeof setInterval>
  private started = false
  /** One cloud round trip at a time; a slow network must not stack them up. */
  private syncing = false

  constructor(
    /**
     * The radio, where there is one.
     *
     * Null for a child who has been enrolled online but never paired over
     * Bluetooth — an ordinary case now, and one that still deserves a thread.
     */
    private transport: Transport | null,
    private side: 'parent' | 'child',
    private storageKey: string,
  ) {}

  async start() {
    this.notes = await loadJSON<NoteState[]>(this.storageKey, [])
    this.started = true
    this.unsubscribe = this.transport?.onMessage((m) => void this.onMessage(m))
    this.transport?.onStatus((s) => {
      // Every reconnection is a delivery opportunity for the backlog.
      if (s.state === 'connected') void this.flushRadio()
    })
    this.emit()
    await this.syncCloud()
  }

  async stop() {
    this.unsubscribe?.()
    this.detachCloud()
    this.started = false
    await this.persist()
  }

  /**
   * Attaches, replaces or removes the internet path.
   *
   * Called after `start()` in practice: a parent's phone learns which cloud
   * child a pairing belongs to only when the child says so, and a child device
   * is very often enrolled after its agent is already running.
   */
  setCloud(channel: NoteChannel | null) {
    if (this.cloud === channel) return
    this.detachCloud()
    this.cloud = channel
    if (!channel) return

    this.unwatchCloud = channel.subscribe?.(() => void this.syncCloud())
    this.poller = setInterval(() => void this.syncCloud(), channel.pollMs ?? DEFAULT_POLL_MS)
    if (this.started) void this.syncCloud()
  }

  private detachCloud() {
    this.unwatchCloud?.()
    this.unwatchCloud = undefined
    if (this.poller) clearInterval(this.poller)
    this.poller = undefined
    this.cloud = null
  }

  onChange(cb: (n: NoteState[]) => void) {
    this.subs.add(cb)
    cb(this.notes)
    return () => this.subs.delete(cb)
  }

  list(): NoteState[] {
    return this.notes
  }

  /** Queue a note. Goes out over whichever links are available right now. */
  async send(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return

    this.notes.push({
      id: `n-${this.side}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: this.side,
      text: trimmed,
      ts: Date.now(),
      delivered: false,
    })
    this.trim()
    await this.persist()
    this.emit()
    // The internet first: it is the link that works at a distance, which is the
    // only situation where leaving a note is interesting.
    await this.syncCloud()
    await this.flushRadio()
  }

  /* ------------------------------------------------------------------ cloud */

  /**
   * Runs a cloud round trip now.
   *
   * For anything that knows something has changed and should not wait out the
   * poll — a screen coming back into view, a test that would otherwise be
   * timing-dependent. Safe to call at any time; it no-ops without a channel and
   * will not stack up behind one already in flight.
   */
  async syncNow() {
    await this.syncCloud()
  }

  /**
   * One round trip: upload what the server has not got, take what it has.
   *
   * Failure is silent by design. Being offline is the expected state for this
   * product, not an exception — the notes stay queued, the radio is still there,
   * and the next attempt is twenty seconds away.
   */
  private async syncCloud() {
    const channel = this.cloud
    if (!channel || this.syncing) return
    this.syncing = true
    try {
      const outbound = this.notes
        .filter((n) => n.from === this.side && !n.synced && !n.delivered)
        .slice(0, 20)
      if (outbound.length > 0) {
        const stored = new Set(await channel.send(outbound.map(strip)))
        if (stored.size > 0) {
          this.notes = this.notes.map((n) => (stored.has(n.id) ? { ...n, synced: true } : n))
          await this.persist()
          this.emit()
        }
      }

      const pending = this.notes
        .filter((n) => n.from === this.side && !n.delivered)
        .map((n) => n.id)
      const { incoming, delivered } = await channel.poll(pending)

      const held = await this.store(incoming)
      // Acknowledged only once it is on this device's own disk. Doing it on
      // receipt would let a note vanish in the gap and still read "delivered"
      // on the phone that sent it.
      if (held.length > 0) await channel.ack(held)
      await this.markDelivered(delivered)
    } catch {
      /* offline, signed out, or not enrolled yet — try again next tick */
    } finally {
      this.syncing = false
    }
  }

  /* ------------------------------------------------------------------ radio */

  /**
   * Resends anything this side wrote that has not been acknowledged.
   *
   * Gated on delivery rather than on whether the cloud accepted it. A note the
   * server holds has still not reached a child whose mobile data is off, and
   * that child may well be standing next to the parent — which is precisely the
   * case Bluetooth exists to cover. Duplicates cost nothing: both ends
   * de-duplicate on the note's id.
   */
  private async flushRadio() {
    if (!this.transport || this.transport.status().state !== 'connected') return
    const pending = this.notes.filter((n) => n.from === this.side && !n.delivered)
    if (pending.length === 0) return
    await this.transport.send({ t: 'notes', notes: pending.slice(0, 20).map(strip) })
  }

  private async onMessage(msg: Message) {
    if (msg.t === 'notes') {
      await this.store(msg.notes)
      // Acknowledge everything in the batch, including repeats — otherwise the
      // sender keeps retrying notes we already hold.
      await this.transport?.send({ t: 'note-ack', ids: msg.notes.map((n) => n.id) })
      return
    }

    if (msg.t === 'note-ack') await this.markDelivered(msg.ids)
  }

  /* ------------------------------------------------------------------ store */

  /**
   * Files notes from the other side, whichever link brought them.
   *
   * Returns every id now held, repeats included: an ack that skipped notes we
   * already had would leave the sender retrying them for ever, because a lost
   * ack is indistinguishable from a lost note.
   */
  private async store(incoming: Note[]): Promise<string[]> {
    // Anything from this side is our own note returning — over the loopback
    // transport, or read back from the server row we just wrote. Ignore it
    // rather than duplicating the thread.
    const theirs = incoming.filter((n) => n.from !== this.side)
    if (theirs.length === 0) return []

    const known = new Set(this.notes.map((n) => n.id))
    const fresh = theirs.filter((n) => !known.has(n.id))
    if (fresh.length > 0) {
      this.notes.push(...fresh.map((n) => ({ ...n, delivered: true })))
      this.notes.sort((a, b) => a.ts - b.ts)
      this.trim()
      await this.persist()
      this.emit()
    }
    return theirs.map((n) => n.id)
  }

  private async markDelivered(ids: string[]) {
    if (ids.length === 0) return
    const acked = new Set(ids)
    let changed = false
    this.notes = this.notes.map((n) => {
      if (acked.has(n.id) && !n.delivered) {
        changed = true
        return { ...n, delivered: true }
      }
      return n
    })
    if (changed) {
      await this.persist()
      this.emit()
    }
  }

  private trim() {
    if (this.notes.length > MAX_NOTES) {
      this.notes.splice(0, this.notes.length - MAX_NOTES)
    }
  }

  private async persist() {
    await saveJSON(this.storageKey, this.notes)
  }

  private emit() {
    // A fresh array each time so React sees the change.
    const snapshot = [...this.notes]
    for (const cb of this.subs) cb(snapshot)
  }
}

/** The wire form: local delivery bookkeeping is nobody else's business. */
function strip({ id, from, text, ts }: NoteState): Note {
  return { id, from, text, ts }
}
