import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHUNK,
  Reassembler,
  distanceM,
  encodeMessage,
  formatClock,
  parseClock,
  scenarioActiveAt,
  type Message,
  type PolicyScenario,
} from './protocol'

/**
 * These cover the parts that cannot be checked by looking at a screen: framing
 * survives a lossy radio, and a scenario's active window is right at the edges.
 * Both are places where a quiet bug means the child's phone silently stops
 * enforcing a rule, which is the worst possible failure for this product.
 */

const telemetry: Message = {
  t: 'telemetry',
  ts: 1_700_000_000_000,
  battery: 64,
  charging: false,
  fix: { lat: 51.5074, lng: -0.1278, acc: 12, ts: 1_700_000_000_000 },
  activeScenarioId: 'school',
  locked: true,
}

describe('framing', () => {
  it('round-trips a message through chunking', () => {
    const rx = new Reassembler()
    const out: Message[] = []
    for (const chunk of encodeMessage(telemetry, 1)) out.push(...rx.push(chunk))
    expect(out).toEqual([telemetry])
  })

  it('splits messages larger than the chunk size', () => {
    const big: Message = {
      t: 'events',
      events: Array.from({ length: 40 }, (_, i) => ({
        seq: i + 1,
        ts: 1_700_000_000_000 + i,
        kind: 'zone-leave' as const,
        ref: `Zone number ${i}`,
      })),
    }
    const chunks = encodeMessage(big, 7)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(DEFAULT_CHUNK)

    const rx = new Reassembler()
    const out: Message[] = []
    for (const c of chunks) out.push(...rx.push(c))
    expect(out).toEqual([big])
  })

  it('reassembles chunks that arrive out of order', () => {
    const chunks = encodeMessage(telemetry, 3, 24)
    expect(chunks.length).toBeGreaterThan(2)

    const rx = new Reassembler()
    const out: Message[] = []
    for (const c of [...chunks].reverse()) out.push(...rx.push(c))
    expect(out).toEqual([telemetry])
  })

  it('abandons a message when a chunk is lost, without wedging the stream', () => {
    const rx = new Reassembler()
    const lossy = encodeMessage(telemetry, 4, 24)
    // Drop the middle chunk.
    for (const [i, c] of lossy.entries()) {
      if (i !== 1) rx.push(c)
    }

    // The next complete message still gets through.
    const out: Message[] = []
    for (const c of encodeMessage({ t: 'ack', upTo: 9, policyVersion: 2 }, 5, 24)) {
      out.push(...rx.push(c))
    }
    expect(out).toEqual([{ t: 'ack', upTo: 9, policyVersion: 2 }])
  })

  it('ignores malformed frames rather than throwing', () => {
    const rx = new Reassembler()
    expect(rx.push(new Uint8Array([1]))).toEqual([])
    expect(rx.push(new Uint8Array([1, 0, 0, 0]))).toEqual([])
    // A single-chunk frame whose body is not JSON.
    expect(rx.push(new Uint8Array([9, 0, 1, 0, 123, 34, 120]))).toEqual([])
  })

  it('starts over when a message id is reused with a different length', () => {
    const rx = new Reassembler()
    rx.push(encodeMessage(telemetry, 8, 24)[0])
    // Same id, new message — the half-received one must not corrupt it.
    const out: Message[] = []
    for (const c of encodeMessage({ t: 'ack', upTo: 1, policyVersion: 1 }, 8, 400)) {
      out.push(...rx.push(c))
    }
    expect(out).toEqual([{ t: 'ack', upTo: 1, policyVersion: 1 }])
  })
})

describe('scenario windows', () => {
  const base: PolicyScenario = {
    id: 'school',
    name: 'School Hours',
    days: [0, 1, 2, 3, 4], // Mon–Fri
    fromMin: 8 * 60,
    toMin: 15 * 60,
    enabled: true,
    blocks: { games: true, social: true, messaging: false },
  }

  // 2026-08-05 is a Wednesday.
  const wed = (h: number, m = 0) => new Date(2026, 7, 5, h, m)
  const sat = (h: number, m = 0) => new Date(2026, 7, 8, h, m)

  it('is active inside the window on a listed day', () => {
    expect(scenarioActiveAt(base, wed(9))).toBe(true)
  })

  it('is inclusive at the start and exclusive at the end', () => {
    expect(scenarioActiveAt(base, wed(8, 0))).toBe(true)
    expect(scenarioActiveAt(base, wed(14, 59))).toBe(true)
    expect(scenarioActiveAt(base, wed(15, 0))).toBe(false)
    expect(scenarioActiveAt(base, wed(7, 59))).toBe(false)
  })

  it('is inactive on days not listed', () => {
    expect(scenarioActiveAt(base, sat(9))).toBe(false)
  })

  it('is inactive when disabled', () => {
    expect(scenarioActiveAt({ ...base, enabled: false }, wed(9))).toBe(false)
  })

  it('handles a window that crosses midnight', () => {
    // Bedtime: 21:00 -> 07:00, listed on Wednesday.
    const bedtime: PolicyScenario = {
      ...base,
      id: 'bedtime',
      days: [2], // Wednesday
      fromMin: 21 * 60,
      toMin: 7 * 60,
    }
    expect(scenarioActiveAt(bedtime, wed(22))).toBe(true)
    // 2am Thursday still belongs to Wednesday night's window.
    expect(scenarioActiveAt(bedtime, new Date(2026, 7, 6, 2))).toBe(true)
    // 8am Thursday is past it.
    expect(scenarioActiveAt(bedtime, new Date(2026, 7, 6, 8))).toBe(false)
    // 2am Wednesday belongs to Tuesday night, which is not listed.
    expect(scenarioActiveAt(bedtime, wed(2))).toBe(false)
  })
})

describe('geo', () => {
  it('measures a short distance accurately', () => {
    // Two points ~111m apart in latitude.
    const d = distanceM({ lat: 51.5, lng: -0.1 }, { lat: 51.501, lng: -0.1 })
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })

  it('is zero for the same point', () => {
    expect(distanceM({ lat: 51.5, lng: -0.1 }, { lat: 51.5, lng: -0.1 })).toBe(0)
  })
})

describe('clock parsing', () => {
  it.each([
    ['8:00 AM', 480],
    ['12:00 PM', 720],
    ['12:00 AM', 0],
    ['3:00 PM', 900],
    ['20:30', 1230],
    ['09:05', 545],
  ])('parses %s', (text, expected) => {
    expect(parseClock(text)).toBe(expected)
  })

  it('round-trips through formatting', () => {
    for (const m of [0, 60, 480, 720, 900, 1439]) {
      expect(parseClock(formatClock(m))).toBe(m)
    }
  })
})
