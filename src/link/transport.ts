import {
  DEFAULT_CHUNK,
  Reassembler,
  encodeMessage,
  type Message,
} from './protocol'

export type LinkState =
  | 'off'
  | 'starting'
  | 'advertising'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error'

export type Peer = { id: string; name: string; rssi?: number }

export type LinkStatus = {
  state: LinkState
  /** Human-readable detail for the UI — an error reason, a peer name. */
  detail?: string
  peer?: Peer
  lastRxAt?: number
}

/**
 * A bidirectional message link to the other device.
 *
 * Three implementations share it: BLE central (parent), BLE peripheral (child),
 * and a BroadcastChannel loopback used for development and for exercising the
 * whole parent/child flow in a browser without two phones.
 */
export interface Transport {
  readonly kind: 'ble-central' | 'ble-peripheral' | 'loopback'
  /** Begin advertising (child) or scanning/connecting (parent). */
  start(): Promise<void>
  stop(): Promise<void>
  send(msg: Message): Promise<void>
  onMessage(cb: (m: Message) => void): () => void
  onStatus(cb: (s: LinkStatus) => void): () => void
  status(): LinkStatus
  /** Central only: discover nearby child devices for the pairing screen. */
  scan?(ms: number): Promise<Peer[]>
  /** Central only: bind to a specific device and remember it. */
  connectTo?(deviceId: string): Promise<void>
  /**
   * Drop whatever is in flight and try the paired peer again straight away.
   *
   * The automatic retry runs on a 30s timer, which is right for background
   * recovery but useless when a parent is standing next to their child holding
   * the phone. This is what the Reconnect button calls.
   */
  reconnect?(): Promise<void>
}

/**
 * Shared plumbing: chunking outbound messages, reassembling inbound frames,
 * and fanning out status. Subclasses only implement the radio-specific
 * `writeChunk` and lifecycle.
 */
export abstract class BaseTransport implements Transport {
  abstract readonly kind: Transport['kind']

  protected chunkSize = DEFAULT_CHUNK
  private msgId = 0
  private rx = new Reassembler()
  private msgSubs = new Set<(m: Message) => void>()
  private statusSubs = new Set<(s: LinkStatus) => void>()
  private current: LinkStatus = { state: 'off' }
  private sweeper?: ReturnType<typeof setInterval>

  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  /** Push one framed chunk onto the radio. */
  protected abstract writeChunk(chunk: Uint8Array): Promise<void>

  async send(msg: Message): Promise<void> {
    this.msgId = (this.msgId + 1) & 0xff
    for (const chunk of encodeMessage(msg, this.msgId, this.chunkSize)) {
      await this.writeChunk(chunk)
    }
  }

  /** Subclasses call this with whatever bytes arrived. */
  protected receive(frame: Uint8Array) {
    for (const msg of this.rx.push(frame)) {
      this.setStatus({ lastRxAt: Date.now() })
      for (const cb of this.msgSubs) cb(msg)
    }
  }

  onMessage(cb: (m: Message) => void) {
    this.msgSubs.add(cb)
    return () => this.msgSubs.delete(cb)
  }

  onStatus(cb: (s: LinkStatus) => void) {
    this.statusSubs.add(cb)
    cb(this.current)
    return () => this.statusSubs.delete(cb)
  }

  status() {
    return this.current
  }

  protected setStatus(patch: Partial<LinkStatus>) {
    this.current = { ...this.current, ...patch }
    for (const cb of this.statusSubs) cb(this.current)
  }

  /** Start dropping half-received messages that will never complete. */
  protected beginSweep() {
    this.sweeper ??= setInterval(() => this.rx.sweep(), 10_000)
  }

  protected endSweep() {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = undefined
    this.rx.reset()
  }
}
