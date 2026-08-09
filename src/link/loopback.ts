import { BaseTransport, type Peer, type Transport } from './transport'

type Wire =
  /** Out-of-band handshake, standing in for BLE connect + CCCD subscribe. */
  | { kind: 'presence'; from: 'parent' | 'child'; reply: boolean }
  | { kind: 'chunk'; from: 'parent' | 'child'; chunk: number[] }

/**
 * A BroadcastChannel-backed stand-in for the BLE link.
 *
 * This is not a toy: it carries the identical framed chunks the radio does, so
 * the protocol, reassembly, child agent and parent sync logic are all exercised
 * for real. Open the app in two browser tabs — `?device=parent` and
 * `?device=child` — and the whole product works end to end. That is how
 * everything except the radio itself gets tested, given phone-to-phone BLE
 * cannot be driven from a desktop browser.
 *
 * The presence handshake matters. On real BLE the central connects and
 * subscribes, and *that* is what tells both ends they are live. Without an
 * equivalent here the two sides deadlock: neither the agent nor the parent link
 * transmits until its transport reports `connected`, so nothing would ever be
 * the first to speak.
 *
 * Selected automatically when not running natively.
 */
export class LoopbackTransport extends BaseTransport implements Transport {
  readonly kind = 'loopback' as const
  private ch?: BroadcastChannel
  private hello?: ReturnType<typeof setInterval>
  private readonly channelName: string

  constructor(
    private side: 'parent' | 'child',
    pairCode = 'nestly-dev',
  ) {
    super()
    this.channelName = `nestly-link-${pairCode}`
    // Mirror BLE's small payloads so chunking is genuinely exercised rather
    // than every message happening to fit in one frame.
    this.chunkSize = 64
  }

  async start() {
    this.setStatus({ state: 'starting' })
    this.ch = new BroadcastChannel(this.channelName)

    this.ch.onmessage = (ev) => {
      const msg = ev.data as Wire | undefined
      if (!msg || msg.from === this.side) return

      if (msg.kind === 'presence') {
        this.markConnected(msg.from)
        // Answer once, so whoever arrived second is seen too. `reply` stops
        // the two sides ponging forever.
        if (msg.reply) this.announce(false)
        return
      }
      this.markConnected(msg.from)
      this.receive(Uint8Array.from(msg.chunk))
    }

    this.beginSweep()
    this.setStatus({
      state: this.side === 'child' ? 'advertising' : 'scanning',
      detail: 'Loopback link — browser only',
    })

    // Keep announcing until someone answers; the other tab may open later.
    this.announce(true)
    this.hello = setInterval(() => {
      if (this.status().state !== 'connected') this.announce(true)
    }, 500)
  }

  private announce(reply: boolean) {
    this.ch?.postMessage({ kind: 'presence', from: this.side, reply } satisfies Wire)
  }

  private markConnected(from: 'parent' | 'child') {
    if (this.status().state === 'connected') return
    this.setStatus({
      state: 'connected',
      detail: undefined,
      peer: { id: `loopback-${from}`, name: from === 'child' ? 'Child device' : 'Parent phone' },
    })
  }

  async stop() {
    if (this.hello) clearInterval(this.hello)
    this.hello = undefined
    this.ch?.close()
    this.ch = undefined
    this.endSweep()
    this.setStatus({ state: 'off', peer: undefined })
  }

  protected async writeChunk(chunk: Uint8Array) {
    this.ch?.postMessage({
      kind: 'chunk',
      from: this.side,
      chunk: Array.from(chunk),
    } satisfies Wire)
  }

  async scan(ms: number): Promise<Peer[]> {
    this.announce(true)
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const peer = this.status().peer
      if (peer) return [peer]
      await new Promise((r) => setTimeout(r, 150))
    }
    return []
  }

  async connectTo(_deviceId: string) {
    this.announce(true)
  }

  async reconnect() {
    this.announce(true)
  }
}
