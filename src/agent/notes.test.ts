import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteBox, type NoteChannel } from './notes'
import { BaseTransport, type Transport } from '../link/transport'
import type { Note } from '../link/protocol'
import { __resetMemoryForTests } from '../platform/storage'

/**
 * Notes are the one feature where "did it actually arrive?" is the whole
 * question, so delivery state gets tested rather than eyeballed.
 *
 * A note now has two ways to travel, and the tests cover the seam between them
 * rather than each in isolation: that the internet carries a note with no radio
 * at all, that Bluetooth still carries one with no internet, and — the part
 * that would be quietly wrong in production — that a note crossing both at once
 * arrives exactly once.
 */

class FakePair extends BaseTransport implements Transport {
  readonly kind = 'loopback' as const
  peer?: FakePair
  inRange = true

  constructor() {
    super()
    this.chunkSize = 32
  }

  async start() {
    this.setStatus({ state: 'connected' })
  }
  async stop() {
    this.setStatus({ state: 'off' })
  }
  protected async writeChunk(chunk: Uint8Array) {
    if (this.inRange && this.peer) this.peer.receive(Uint8Array.from(chunk))
  }
  setRange(v: boolean) {
    this.inRange = v
    this.setStatus({ state: v ? 'connected' : 'scanning' })
  }
}

function pair() {
  const a = new FakePair()
  const b = new FakePair()
  a.peer = b
  b.peer = a
  return { a, b }
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

const boxes: NoteBox[] = []

beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  __resetMemoryForTests()
})

afterEach(async () => {
  while (boxes.length) await boxes.pop()!.stop()
})

function make(transport: FakePair | null, side: 'parent' | 'child') {
  // Separate storage keys: on a real pair these live on different phones.
  const box = new NoteBox(transport, side, `notes.${side}`)
  boxes.push(box)
  return box
}

/**
 * A stand-in for the `notes` table, with the two properties the real one has
 * that matter here: `client_id` is unique, so a resend is a no-op, and
 * `delivered_at` is set by the *recipient*, not by the server accepting a row.
 *
 * One server, two channels — deliberately, because the parent and the child
 * reach the real one through completely different doors (RLS and an edge
 * function) and the bug worth catching is the two of them disagreeing.
 */
class FakeServer {
  rows = new Map<string, { note: Note; delivered: boolean }>()
  /** No signal. Every call rejects, exactly as fetch does. */
  down = false
  sends = 0
  private subs = new Set<() => void>()

  channel(side: 'parent' | 'child'): NoteChannel {
    const guard = () => {
      if (this.down) throw new Error('offline')
    }
    return {
      // Long enough that nothing fires by accident; the tests drive syncNow().
      pollMs: 60 * 60_000,
      send: async (notes) => {
        guard()
        this.sends += 1
        for (const n of notes) {
          if (!this.rows.has(n.id)) this.rows.set(n.id, { note: n, delivered: false })
        }
        this.notify()
        return notes.map((n) => n.id)
      },
      poll: async (pendingIds) => {
        guard()
        return {
          incoming: [...this.rows.values()]
            .filter((r) => r.note.from !== side)
            .map((r) => r.note),
          delivered: pendingIds.filter((id) => this.rows.get(id)?.delivered),
        }
      },
      ack: async (ids) => {
        guard()
        let changed = false
        for (const id of ids) {
          const row = this.rows.get(id)
          if (row && !row.delivered) {
            row.delivered = true
            changed = true
          }
        }
        if (changed) this.notify()
      },
      subscribe: (cb) => {
        this.subs.add(cb)
        return () => this.subs.delete(cb)
      },
    }
  }

  private notify() {
    for (const cb of this.subs) cb()
  }
}

describe('notes', () => {
  it('delivers a note and marks it delivered only once acknowledged', async () => {
    const { a, b } = pair()
    const parent = make(a, 'parent')
    const child = make(b, 'child')
    await a.start()
    await b.start()
    await parent.start()
    await child.start()

    await parent.send('Home by six please')
    await settle()

    expect(child.list().map((n) => n.text)).toEqual(['Home by six please'])
    expect(parent.list()[0].delivered).toBe(true)
  })

  it('holds a note while out of range and delivers it on reconnect', async () => {
    const { a, b } = pair()
    const parent = make(a, 'parent')
    const child = make(b, 'child')
    await a.start()
    await b.start()
    await parent.start()
    await child.start()

    a.setRange(false)
    await parent.send('Call me when you land')
    await settle()

    expect(child.list()).toHaveLength(0)
    expect(parent.list()[0].delivered).toBe(false)

    a.setRange(true)
    await settle()

    expect(child.list().map((n) => n.text)).toEqual(['Call me when you land'])
    expect(parent.list()[0].delivered).toBe(true)
  })

  it('does not duplicate a note that is resent', async () => {
    const { a, b } = pair()
    const parent = make(a, 'parent')
    const child = make(b, 'child')
    await a.start()
    await b.start()
    await parent.start()
    await child.start()

    await parent.send('Dinner is ready')
    await settle()

    // Simulate the sender retrying because an ack was lost.
    a.setRange(false)
    a.setRange(true)
    await settle()

    expect(child.list()).toHaveLength(1)
  })

  it('carries notes in both directions', async () => {
    const { a, b } = pair()
    const parent = make(a, 'parent')
    const child = make(b, 'child')
    await a.start()
    await b.start()
    await parent.start()
    await child.start()

    await parent.send('Are you at school?')
    await settle()
    await child.send('Yes, just got here')
    await settle()

    expect(parent.list().map((n) => `${n.from}:${n.text}`)).toEqual([
      'parent:Are you at school?',
      'child:Yes, just got here',
    ])
    expect(child.list()).toHaveLength(2)
  })

  it('crosses over the internet with no radio at all', async () => {
    // The setup a family now arrives with: a phone enrolled by code, never
    // paired over Bluetooth. Before notes went to the cloud this thread had
    // nowhere to go and the screen simply swallowed what was typed into it.
    const server = new FakeServer()
    const parent = make(null, 'parent')
    const child = make(null, 'child')
    parent.setCloud(server.channel('parent'))
    child.setCloud(server.channel('child'))
    await parent.start()
    await child.start()

    await parent.send('Text me when you get there')
    await child.syncNow()

    expect(child.list().map((n) => n.text)).toEqual(['Text me when you get there'])

    // Not delivered until the *child* has it — the server holding a row is not
    // the claim the tick is making.
    await parent.syncNow()
    expect(parent.list()[0].delivered).toBe(true)
  })

  it('falls back to Bluetooth when the internet is gone', async () => {
    const server = new FakeServer()
    const { a, b } = pair()
    const parent = make(a, 'parent')
    const child = make(b, 'child')
    parent.setCloud(server.channel('parent'))
    child.setCloud(server.channel('child'))
    await a.start()
    await b.start()
    await parent.start()
    await child.start()

    server.down = true
    await parent.send('Dinner at six')
    await settle()

    // Nothing reached the server, and the note still arrived.
    expect(server.rows.size).toBe(0)
    expect(child.list().map((n) => n.text)).toEqual(['Dinner at six'])
    expect(parent.list()[0].delivered).toBe(true)
  })

  it('holds a note when both links are down, and sends it when either returns', async () => {
    const server = new FakeServer()
    const { a, b } = pair()
    const parent = make(a, 'parent')
    const child = make(b, 'child')
    parent.setCloud(server.channel('parent'))
    child.setCloud(server.channel('child'))
    await a.start()
    await b.start()
    await parent.start()
    await child.start()

    server.down = true
    a.setRange(false)
    await parent.send('Are you up?')
    await settle()
    expect(child.list()).toHaveLength(0)
    expect(parent.list()[0].delivered).toBe(false)

    // The internet comes back first; Bluetooth is still nowhere.
    server.down = false
    await parent.syncNow()
    await child.syncNow()
    await parent.syncNow()

    expect(child.list().map((n) => n.text)).toEqual(['Are you up?'])
    expect(parent.list()[0].delivered).toBe(true)
  })

  it('arrives once when a note crosses both links', async () => {
    const server = new FakeServer()
    const { a, b } = pair()
    const parent = make(a, 'parent')
    const child = make(b, 'child')
    parent.setCloud(server.channel('parent'))
    child.setCloud(server.channel('child'))
    await a.start()
    await b.start()
    await parent.start()
    await child.start()

    // Both paths live: the radio delivers it and the server has it too.
    await parent.send('Bring your coat')
    await settle()
    await child.syncNow()
    await parent.syncNow()

    // The note's own id is what makes this safe, exactly as `seq` does for
    // events. Without it a child holding both phones' worth of the same
    // sentence is what a parent would see.
    expect(child.list()).toHaveLength(1)
    expect(parent.list()).toHaveLength(1)
  })

  it('does not re-upload a note the server already has', async () => {
    const server = new FakeServer()
    const parent = make(null, 'parent')
    parent.setCloud(server.channel('parent'))
    await parent.start()

    await parent.send('Call your gran')
    const afterFirst = server.sends

    await parent.syncNow()
    await parent.syncNow()

    expect(server.sends).toBe(afterFirst)
  })

  it('keeps a note queued when the upload fails', async () => {
    // A failed send that reported success would drop the note entirely: the
    // radio only retries what is still undelivered.
    const server = new FakeServer()
    const parent = make(null, 'parent')
    const channel = server.channel('parent')
    const send = vi.spyOn(channel, 'send').mockRejectedValueOnce(new Error('offline'))
    parent.setCloud(channel)
    await parent.start()

    await parent.send('Lunch money on the side')
    expect(parent.list()[0].delivered).toBe(false)
    expect(server.rows.size).toBe(0)

    send.mockRestore()
    await parent.syncNow()
    expect(server.rows.size).toBe(1)
  })

  it('ignores an empty note', async () => {
    const { a, b } = pair()
    const parent = make(a, 'parent')
    await a.start()
    await b.start()
    await parent.start()

    await parent.send('   ')
    await settle()
    expect(parent.list()).toHaveLength(0)
  })
})
