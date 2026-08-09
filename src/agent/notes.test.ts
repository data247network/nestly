import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NoteBox } from './notes'
import { BaseTransport, type Transport } from '../link/transport'
import { __resetMemoryForTests } from '../platform/storage'

/**
 * Notes are the one feature where "did it actually arrive?" is the whole
 * question, so delivery state gets tested rather than eyeballed.
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

function make(transport: FakePair, side: 'parent' | 'child') {
  // Separate storage keys: on a real pair these live on different phones.
  const box = new NoteBox(transport, side, `notes.${side}`)
  boxes.push(box)
  return box
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
