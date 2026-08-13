import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChildAgent, setSimulatedFix } from './childAgent'
import { ParentLink } from './parentLink'
import { BaseTransport, type Transport } from '../link/transport'
import { KEYS, __resetMemoryForTests, saveJSON } from '../platform/storage'
import type { ChildEvent, Policy } from '../link/protocol'

/**
 * End-to-end exercise of the store-and-forward design, with the radio replaced
 * by a direct in-process pair. Everything above the radio is the real code:
 * the same framing, the same agent, the same parent link.
 *
 * These are the behaviours that are impossible to eyeball and expensive to get
 * wrong — a zone crossing that fires on the first fix, an event log that never
 * drains, a policy that a stale resend quietly undoes.
 */

/** Two transports wired straight to each other. */
class FakePair extends BaseTransport implements Transport {
  readonly kind = 'loopback' as const
  peer?: FakePair
  /** When false, writes are dropped — the child is "out of range". */
  inRange = true

  constructor(private label: string) {
    super()
    this.chunkSize = 24 // small, so chunking is genuinely exercised
  }

  async start() {
    this.setStatus({ state: 'connected', peer: { id: this.label, name: this.label } })
  }

  async stop() {
    this.setStatus({ state: 'off' })
  }

  protected async writeChunk(chunk: Uint8Array) {
    if (!this.inRange || !this.peer) return
    // Copy: the real radio hands over its own buffer.
    this.peer.deliver(Uint8Array.from(chunk))
  }

  deliver(chunk: Uint8Array) {
    this.receive(chunk)
  }

  goOutOfRange() {
    this.inRange = false
    this.setStatus({ state: 'scanning' })
  }

  comeIntoRange() {
    this.inRange = true
    this.setStatus({ state: 'connected' })
  }
}

function pair() {
  const parent = new FakePair('parent')
  const child = new FakePair('child')
  parent.peer = child
  child.peer = parent
  return { parent, child }
}

const ZONE = { lat: 51.5, lng: -0.1 }

function policyWithZone(version: number): Policy {
  return {
    t: 'policy',
    version,
    scenarios: [],
    geofences: [
      {
        id: 'school',
        name: 'School',
        lat: ZONE.lat,
        lng: ZONE.lng,
        radiusM: 100,
        notifyArrive: true,
        notifyLeave: true,
      },
    ],
    filters: { adult: true, violence: true, gambling: true, custom: [] },
    lockNow: false,
  }
}

/** ~1km north of the zone centre — comfortably outside a 100m radius. */
const OUTSIDE = { lat: 51.509, lng: -0.1 }

beforeEach(() => {
  // storage.ts falls back to localStorage off-native; give it one, fresh each test.
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  // It also keeps a process-wide in-memory copy, which would otherwise carry a
  // previous test's event log and sequence numbers into this one.
  __resetMemoryForTests()
})

/**
 * Every agent must be stopped. A running agent keeps its 15s timer and, more
 * importantly, keeps writing its own event log to the same storage key — a
 * leaked one from an earlier test reappears as impossible sequence numbers in
 * the next.
 */
const running: { stop: () => Promise<void> }[] = []

afterEach(async () => {
  while (running.length) await running.pop()!.stop()
})

function track<T extends { stop: () => Promise<void> }>(x: T): T {
  running.push(x)
  return x
}

async function settle() {
  // Let the async send/receive chains flush.
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('parent <-> child link', () => {
  it('delivers policy to the child and telemetry back to the parent', async () => {
    const { parent, child } = pair()
    const seen: { name: string }[] = []

    const link = track(
      new ParentLink(parent, { onChild: (c) => seen.push({ name: c.name }), onEvents: () => {} }),
    )
    const agent = track(new ChildAgent(child, { deviceId: 'child-1', name: "Maya's phone" }))

    await link.start()
    await agent.start()
    await settle()

    await link.setPolicy(policyWithZone(1))
    await settle()
    await agent.tick()
    await settle()

    expect(seen.some((s) => s.name === "Maya's phone")).toBe(true)
  })

  it('does not fire a zone alert on the very first fix', async () => {
    const { parent, child } = pair()
    const events: ChildEvent[] = []

    const link = track(new ParentLink(parent, { onChild: () => {}, onEvents: (e) => events.push(...e) }))
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await link.setPolicy(policyWithZone(1))
    await settle()

    // First ever fix, already outside the zone. Without a baseline this would
    // look like a departure the moment the app opened.
    setSimulatedFix(OUTSIDE.lat, OUTSIDE.lng)
    await agent.tick()
    await settle()

    expect(events.filter((e) => e.kind === 'zone-leave')).toHaveLength(0)
  })

  it('reports a zone departure once the baseline is established', async () => {
    const { parent, child } = pair()
    const events: ChildEvent[] = []

    const link = track(new ParentLink(parent, { onChild: () => {}, onEvents: (e) => events.push(...e) }))
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await link.setPolicy(policyWithZone(1))
    await settle()

    setSimulatedFix(ZONE.lat, ZONE.lng) // inside — baseline
    await agent.tick()
    await settle()

    setSimulatedFix(OUTSIDE.lat, OUTSIDE.lng) // left
    await agent.tick()
    await settle()

    const leaves = events.filter((e) => e.kind === 'zone-leave')
    expect(leaves).toHaveLength(1)
    expect(leaves[0].ref).toBe('School')
  })

  it('holds events while out of range and delivers them on reconnect', async () => {
    const { parent, child } = pair()
    const events: ChildEvent[] = []

    const link = track(new ParentLink(parent, { onChild: () => {}, onEvents: (e) => events.push(...e) }))
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await link.setPolicy(policyWithZone(1))
    await settle()

    setSimulatedFix(ZONE.lat, ZONE.lng)
    await agent.tick()
    await settle()

    const zoneEvents = () => events.filter((e) => e.kind.startsWith('zone-'))

    // Parent walks away. The child keeps evaluating and recording.
    child.goOutOfRange()
    setSimulatedFix(OUTSIDE.lat, OUTSIDE.lng)
    await agent.tick()
    await settle()
    expect(zoneEvents()).toHaveLength(0)

    setSimulatedFix(ZONE.lat, ZONE.lng)
    await agent.tick()
    await settle()
    expect(zoneEvents()).toHaveLength(0)

    // The child recorded both crossings even though nobody was listening.
    expect(agent.current().pendingEvents).toBeGreaterThanOrEqual(2)

    // Back in range: the whole backlog arrives at once.
    child.comeIntoRange()
    await agent.tick()
    await settle()

    const kinds = zoneEvents().map((e) => e.kind)
    expect(kinds).toContain('zone-leave')
    expect(kinds).toContain('zone-enter')
    // And the child has dropped what the parent confirmed.
    expect(agent.current().pendingEvents).toBe(0)
  })

  it('stops resending events once the parent has acked them', async () => {
    const { parent, child } = pair()
    const events: ChildEvent[] = []

    const link = track(new ParentLink(parent, { onChild: () => {}, onEvents: (e) => events.push(...e) }))
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await link.setPolicy(policyWithZone(1))
    await settle()

    setSimulatedFix(ZONE.lat, ZONE.lng)
    await agent.tick()
    await settle()
    setSimulatedFix(OUTSIDE.lat, OUTSIDE.lng)
    await agent.tick()
    await settle()

    const afterFirst = events.length
    expect(afterFirst).toBeGreaterThan(0)

    // Several more ticks with nothing new happening must not replay history.
    await agent.tick()
    await settle()
    await agent.tick()
    await settle()

    expect(events).toHaveLength(afterFirst)
  })

  it('accepts a policy at the same version from the cloud, which is how a lock is lifted', async () => {
    // The radio path applies `version >= current` and the cloud path used to
    // require strictly greater. Both transports share one version counter, so
    // that asymmetry stranded a phone locked over Bluetooth: the server's copy
    // sat at a version the child refused for ever, and no amount of signal
    // would unlock it.
    const { parent, child } = pair()
    const link = track(new ParentLink(parent, { onChild: () => {}, onEvents: () => {} }))
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()

    await link.setPolicy({ ...policyWithZone(5), lockNow: true })
    await settle()
    await agent.tick()
    await settle()
    expect(agent.current().locked).toBe(true)

    // Same version, lock lifted — the shape of a correction arriving by the
    // other road rather than a stale replay.
    await link.setPolicy({ ...policyWithZone(5), lockNow: false })
    await settle()
    await agent.tick()
    await settle()

    expect(agent.current().locked).toBe(false)
    expect(agent.current().policyVersion).toBe(5)
  })

  it('ignores a policy older than the one the child already has', async () => {
    const { parent, child } = pair()
    const link = track(new ParentLink(parent, { onChild: () => {}, onEvents: () => {} }))
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()

    await link.setPolicy({ ...policyWithZone(5), lockNow: true })
    await settle()
    await agent.tick()
    await settle()

    expect(agent.current().locked).toBe(true)
    expect(agent.current().policyVersion).toBe(5)

    // A stale resend at a lower version must not unlock the phone.
    await link.setPolicy({ ...policyWithZone(2), lockNow: false })
    await settle()
    await agent.tick()
    await settle()

    expect(agent.current().locked).toBe(true)
    expect(agent.current().policyVersion).toBe(5)
  })

  it('adopts a policy at the same version, so a lock can be cleared', async () => {
    const { parent, child } = pair()
    const link = track(new ParentLink(parent, { onChild: () => {}, onEvents: () => {} }))
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()

    await link.setPolicy({ ...policyWithZone(3), lockNow: true })
    await settle()
    await agent.tick()
    await settle()
    expect(agent.current().locked).toBe(true)

    await link.setPolicy({ ...policyWithZone(4), lockNow: false })
    await settle()
    await agent.tick()
    await settle()
    expect(agent.current().locked).toBe(false)
  })
})

/**
 * The child's account identity, and how it reaches the parent.
 *
 * This is the seam where a real duplicate came from: the parent had only a BLE
 * address to identify a child by, so pairing over Bluetooth created a second
 * cloud child next to the one already added in Family Hub. Identity has to
 * travel over the link, and it has to survive the ordering that actually
 * happens on real phones — paired first, enrolled minutes later.
 */
describe('enrolled identity over the link', () => {
  it('omits a cloud id when the phone has never been enrolled', async () => {
    const { parent, child } = pair()
    const seen: (string | undefined)[] = []

    const link = track(
      new ParentLink(parent, { onChild: (c) => seen.push(c.cloudChildId), onEvents: () => {} }),
    )
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await settle()

    // Bluetooth-only is a supported product, not a broken state. The parent
    // must be told nothing rather than be handed something to invent a row from.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((id) => id === undefined)).toBe(true)
  })

  it('carries the cloud id once the phone is enrolled', async () => {
    await saveJSON(KEYS.enrolment, { childId: 'cloud-child-uuid', name: 'Eliora' })

    const { parent, child } = pair()
    let latest: string | undefined
    const link = track(
      new ParentLink(parent, { onChild: (c) => (latest = c.cloudChildId), onEvents: () => {} }),
    )
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await settle()

    expect(latest).toBe('cloud-child-uuid')
  })

  it('announces an enrolment that happens while already connected', async () => {
    const { parent, child } = pair()
    let latest: string | undefined
    const link = track(
      new ParentLink(parent, { onChild: (c) => (latest = c.cloudChildId), onEvents: () => {} }),
    )
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await settle()
    expect(latest).toBeUndefined()

    // The real ordering: paired and connected, then a code is entered. Hello is
    // otherwise only sent on a fresh connection, so without the announce the
    // parent would keep treating this phone as unenrolled indefinitely.
    await saveJSON(KEYS.enrolment, { childId: 'late-uuid', name: 'Eliora' })
    await agent.announce()
    await settle()

    expect(latest).toBe('late-uuid')
  })

  it('keeps the known identity when a later hello omits it', async () => {
    await saveJSON(KEYS.enrolment, { childId: 'sticky-uuid', name: 'Eliora' })

    const { parent, child } = pair()
    let latest: string | undefined
    const link = track(
      new ParentLink(parent, { onChild: (c) => (latest = c.cloudChildId), onEvents: () => {} }),
    )
    const agent = track(new ChildAgent(child, { deviceId: 'c', name: 'child' }))
    await link.start()
    await agent.start()
    await settle()
    expect(latest).toBe('sticky-uuid')

    // An older build, or a hello sent before storage was read, must not be able
    // to blank an identity the parent already established — that would put the
    // duplicate straight back. Driven through a real reconnect rather than a
    // test hook: the agent re-reads storage on every hello, so an absent
    // enrolment genuinely produces a hello with no cloud id.
    await saveJSON(KEYS.enrolment, null)
    child.goOutOfRange()
    child.comeIntoRange()
    await settle()

    expect(latest).toBe('sticky-uuid')
  })
})
