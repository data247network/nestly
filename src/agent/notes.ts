import type { Message, Note } from '../link/protocol'
import type { Transport } from '../link/transport'
import { loadJSON, saveJSON } from '../platform/storage'

/**
 * Two-way notes between the paired phones.
 *
 * The same store-and-forward discipline as the event log, and for the same
 * reason: over Bluetooth a note can only cross when the phones are near each
 * other. So a note is queued locally, retried on every contact, and only marked
 * delivered when the other side has acknowledged storing it. The UI shows that
 * state rather than a hopeful tick.
 *
 * Runs identically on both devices — there is no asymmetry in leaving a note.
 */

export type NoteState = Note & { delivered: boolean }

const MAX_NOTES = 200

export class NoteBox {
  private notes: NoteState[] = []
  private subs = new Set<(n: NoteState[]) => void>()
  private unsubscribe?: () => void

  constructor(
    private transport: Transport,
    private side: 'parent' | 'child',
    private storageKey: string,
  ) {}

  async start() {
    this.notes = await loadJSON<NoteState[]>(this.storageKey, [])
    this.unsubscribe = this.transport.onMessage((m) => void this.onMessage(m))
    this.transport.onStatus((s) => {
      // Every reconnection is a delivery opportunity for the backlog.
      if (s.state === 'connected') void this.flush()
    })
    this.emit()
  }

  async stop() {
    this.unsubscribe?.()
    await this.persist()
  }

  onChange(cb: (n: NoteState[]) => void) {
    this.subs.add(cb)
    cb(this.notes)
    return () => this.subs.delete(cb)
  }

  list(): NoteState[] {
    return this.notes
  }

  /** Queue a note. Sends immediately if the other phone is in range. */
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
    await this.flush()
  }

  /** Resend anything this side wrote that has not been acknowledged. */
  private async flush() {
    if (this.transport.status().state !== 'connected') return
    const pending = this.notes.filter((n) => n.from === this.side && !n.delivered)
    if (pending.length === 0) return
    await this.transport.send({
      t: 'notes',
      notes: pending.slice(0, 20).map(({ id, from, text, ts }) => ({ id, from, text, ts })),
    })
  }

  private async onMessage(msg: Message) {
    if (msg.t === 'notes') {
      const known = new Set(this.notes.map((n) => n.id))
      // Anything from this side echoing back is our own message returning on a
      // loopback; ignore it rather than duplicating the thread.
      const incoming = msg.notes.filter((n) => !known.has(n.id) && n.from !== this.side)
      if (incoming.length > 0) {
        this.notes.push(...incoming.map((n) => ({ ...n, delivered: true })))
        this.notes.sort((a, b) => a.ts - b.ts)
        this.trim()
        await this.persist()
        this.emit()
      }
      // Acknowledge everything in the batch, including repeats — otherwise the
      // sender keeps retrying notes we already hold.
      await this.transport.send({ t: 'note-ack', ids: msg.notes.map((n) => n.id) })
      return
    }

    if (msg.t === 'note-ack') {
      const acked = new Set(msg.ids)
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
