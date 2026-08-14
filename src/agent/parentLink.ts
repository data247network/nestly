import {
  PROTOCOL_VERSION,
  type ChildEvent,
  type Hello,
  type Message,
  type Policy,
  type Telemetry,
  type UsageReport,
} from '../link/protocol'
import type { Peer, Transport } from '../link/transport'

export type ChildLive = {
  deviceId: string
  name: string
  telemetry: Telemetry | null
  /** Wall-clock time the parent last heard anything at all from this child. */
  lastSeenAt: number | null
  policyVersion: number
  /** The account-level child this phone is enrolled as, if it is enrolled. */
  cloudChildId?: string
}

export type ParentLinkHandlers = {
  onChild: (child: ChildLive) => void
  /** Called with newly-received events, oldest first, already de-duplicated. */
  onEvents: (events: ChildEvent[]) => void
  /** The day's usage and browsing snapshot — replaces the previous one. */
  onUsage?: (report: UsageReport) => void
  onProtocolMismatch?: (theirs: number) => void
}

/**
 * The parent device's half of the link.
 *
 * Its job is narrow on purpose: turn incoming frames into child state and
 * events, acknowledge what it has durably stored, and push policy when the
 * parent changes a rule. Everything it receives is treated as a backlog rather
 * than a live feed, because with Bluetooth that is exactly what it is.
 */
export class ParentLink {
  private child: ChildLive | null = null
  /** Highest event seq durably handled — drives the ack and de-duplication. */
  private ackedSeq = 0
  private pendingPolicy: Policy | null = null
  private unsubscribe?: () => void

  constructor(
    private transport: Transport,
    private handlers: ParentLinkHandlers,
    ackedSeq = 0,
  ) {
    this.ackedSeq = ackedSeq
  }

  async start() {
    this.unsubscribe = this.transport.onMessage((m) => void this.onMessage(m))
    this.transport.onStatus((s) => {
      // Re-push policy on every reconnect: the child may have missed the last
      // change entirely while it was out of range.
      if (s.state === 'connected' && this.pendingPolicy) void this.sendPolicy(this.pendingPolicy)
    })
    await this.transport.start()
  }

  async stop() {
    this.unsubscribe?.()
    await this.transport.stop()
  }

  scan(ms = 6000): Promise<Peer[]> {
    return this.transport.scan?.(ms) ?? Promise.resolve([])
  }

  connectTo(deviceId: string) {
    return this.transport.connectTo?.(deviceId) ?? Promise.resolve()
  }

  /**
   * Queues a policy and sends it if the child is reachable. Held either way, so
   * a rule changed while the child is at school still lands when they get home.
   */
  async setPolicy(policy: Policy) {
    this.pendingPolicy = policy
    if (this.transport.status().state === 'connected') await this.sendPolicy(policy)
  }

  private async sendPolicy(policy: Policy) {
    await this.transport.send(policy)
  }

  /**
   * Asks the child's phone where it is now.
   *
   * Returns whether the question was actually asked, so the screen can tell a
   * request that is on its way from one that never left — a parent watching a
   * spinner on a disconnected radio is being lied to. Nothing is queued: this
   * is a live question, and asking it ten minutes later when the phones happen
   * to meet would answer a question nobody is still waiting on.
   */
  async requestLocate(): Promise<boolean> {
    if (this.transport.status().state !== 'connected') return false
    await this.transport.send({ t: 'locate' })
    return true
  }

  getAckedSeq() {
    return this.ackedSeq
  }

  private async onMessage(msg: Message) {
    switch (msg.t) {
      case 'hello':
        return this.onHello(msg)
      case 'telemetry':
        return this.onTelemetry(msg)
      case 'events':
        return this.onEvents(msg.events)
      case 'usage':
        this.handlers.onUsage?.(msg)
        return
      default:
        // 'policy' and 'ack' are parent -> child; seeing one here means the
        // loopback echoed us. Ignore rather than corrupting state.
        return
    }
  }

  private async onHello(hello: Hello) {
    if (hello.protocol !== PROTOCOL_VERSION) {
      this.handlers.onProtocolMismatch?.(hello.protocol)
      return
    }
    this.child = {
      deviceId: hello.deviceId,
      name: hello.name,
      telemetry: this.child?.telemetry ?? null,
      lastSeenAt: Date.now(),
      policyVersion: hello.policyVersion,
      // Keep what we already knew if this hello omits it. An enrolled phone
      // that reconnects before its enrolment is re-read would otherwise appear
      // to have lost its identity, and the parent would mint a duplicate.
      cloudChildId: hello.cloudChildId ?? this.child?.cloudChildId,
    }
    this.handlers.onChild(this.child)

    // The child restarted or was reset: its seq numbering began again, so our
    // stored high-water mark would suppress everything it sends. Rewind.
    if (hello.headSeq < this.ackedSeq) this.ackedSeq = 0

    if (this.pendingPolicy && this.pendingPolicy.version > hello.policyVersion) {
      await this.sendPolicy(this.pendingPolicy)
    }
  }

  private onTelemetry(t: Telemetry) {
    this.child = {
      deviceId: this.child?.deviceId ?? 'unknown',
      name: this.child?.name ?? 'Child device',
      telemetry: t,
      lastSeenAt: Date.now(),
      policyVersion: this.child?.policyVersion ?? 0,
      cloudChildId: this.child?.cloudChildId,
    }
    this.handlers.onChild(this.child)
  }

  private async onEvents(events: ChildEvent[]) {
    const fresh = events
      .filter((e) => e.seq > this.ackedSeq)
      .sort((a, b) => a.seq - b.seq)

    if (fresh.length > 0) {
      this.handlers.onEvents(fresh)
      this.ackedSeq = fresh[fresh.length - 1].seq
    }

    // Ack even when there was nothing new: the child needs to know it can drop
    // the batch it just resent, otherwise it retries the same events forever.
    await this.transport.send({
      t: 'ack',
      upTo: Math.max(this.ackedSeq, ...events.map((e) => e.seq), 0),
      policyVersion: this.pendingPolicy?.version ?? 0,
    })
  }
}
