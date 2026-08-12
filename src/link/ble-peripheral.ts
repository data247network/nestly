import { registerPlugin } from '@capacitor/core'
import { fromBase64, toBase64 } from './protocol'
import { BaseTransport, type Transport } from './transport'

/**
 * Bridge to the custom `NestlyLink` Android plugin — the child device's side.
 *
 * The community BLE plugin is central-only, so the peripheral role (advertise +
 * GATT server) is implemented natively in NestlyLinkPlugin.java. This is the
 * thin TypeScript face of it.
 */
export type FilterRuleInput = {
  adult: boolean
  violence: boolean
  gambling: boolean
  social: boolean
  custom: string[]
  warn: string[]
}

export type FilterDecision = {
  kind: 'blocked' | 'warned' | 'revoked'
  domain: string
  category: string
  ts: number
}

export type NativeVisit = {
  domain: string
  count: number
  lastAt: number
  blocked: boolean
  category: string
}

export type NativeUsage = {
  pkg: string
  label: string
  minutes: number
  category: 'social' | 'games' | 'video' | 'education' | 'other'
}

export type NestlyLinkPlugin = {
  isSupported(): Promise<{ ble: boolean; enabled: boolean; peripheral: boolean }>
  ensurePermissions(): Promise<{ location: boolean; bluetooth: boolean }>
  start(options: { name: string }): Promise<void>
  stop(): Promise<void>
  getStatus(): Promise<{ running: boolean; subscribers: number; bufferedFixes: number }>
  send(options: { data: string }): Promise<{ delivered: number }>
  drainFixes(): Promise<{ fixes: { lat: number; lng: number; acc: number; ts: number }[] }>
  getBattery(): Promise<{ level: number | null; charging: boolean | null }>

  /** Web filtering — a local DNS-intercepting VPN on the child device. */
  filterStatus(): Promise<{ consented: boolean; running: boolean }>
  requestFilterConsent(): Promise<{ consented: boolean }>
  startFilter(rules: FilterRuleInput): Promise<void>
  updateFilter(rules: FilterRuleInput): Promise<void>
  stopFilter(): Promise<void>
  drainFilterEvents(): Promise<{
    events: FilterDecision[]
    visits: NativeVisit[]
    running: boolean
  }>

  /** Posts a reminder as a real Android notification on the child's phone. */
  notify(options: { title: string; body: string; id: number }): Promise<void>

  /**
   * Names of contacts added since the last call. Additions only — the address
   * book is never read out, and numbers never leave the device.
   */
  drainNewContacts(): Promise<{ granted: boolean; added: string[] }>
  requestContactsPermission(): Promise<{ granted: boolean }>

  /** Whether "display over other apps" has been granted — the enforced lock needs it. */
  canOverlay(): Promise<{ allowed: boolean }>
  /** Uninstall resistance: active means Android refuses to remove the app. */
  adminStatus(): Promise<{ active: boolean }>
  requestAdmin(): Promise<void>
  /**
   * Everything protective, in one read, plus any record of admin being turned
   * off since the last call. Draining it here means one deactivation is
   * reported once rather than on every tick.
   */
  protectionStatus(): Promise<{
    adminActive: boolean
    adminDisabledAt: number
    overlayAllowed: boolean
    filterRunning: boolean
    usageAccess: boolean
  }>
  requestOverlayPermission(): Promise<void>
  /**
   * Puts the lock over every other app, or takes it away.
   *
   * `contacts` is a flat name/number list. They appear on the lock itself: a
   * lock that could stop a child calling for help would be a hazard wearing the
   * costume of a safety feature.
   */
  setLocked(opts: {
    locked: boolean
    title?: string
    subtitle?: string
    contacts?: string[]
  }): Promise<void>

  /** Per-app screen time. Needs the Usage Access special permission. */
  hasUsageAccess(): Promise<{ granted: boolean }>
  openUsageSettings(): Promise<void>
  getUsageToday(): Promise<{ granted: boolean; apps: NativeUsage[] }>
  addListener(
    event: 'rx',
    cb: (e: { data: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>
  addListener(
    event: 'state',
    cb: (e: { state: string; detail?: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

export const NestlyLink = registerPlugin<NestlyLinkPlugin>('NestlyLink')

export class BlePeripheralTransport extends BaseTransport implements Transport {
  readonly kind = 'ble-peripheral' as const
  private handles: { remove: () => Promise<void> }[] = []

  constructor(private deviceName: string) {
    super()
    // Conservative: a GATT notification is capped at MTU-3, and MTU is only
    // 23 until the central negotiates up. 20 bytes always fits.
    this.chunkSize = 20
  }

  async start() {
    this.setStatus({ state: 'starting' })

    const support = await NestlyLink.isSupported()
    if (!support.ble) {
      this.setStatus({ state: 'error', detail: 'This phone has no Bluetooth LE.' })
      return
    }
    if (!support.peripheral) {
      // Genuinely a device limitation, not a bug — say so rather than
      // retrying forever.
      this.setStatus({
        state: 'error',
        detail: 'This phone cannot act as a Bluetooth peripheral, so it cannot be a child device.',
      })
      return
    }
    if (!support.enabled) {
      this.setStatus({ state: 'error', detail: 'Turn Bluetooth on to connect.' })
      return
    }

    const perms = await NestlyLink.ensurePermissions()
    if (!perms.bluetooth) {
      this.setStatus({ state: 'error', detail: 'Bluetooth permission is needed to connect.' })
      return
    }

    this.handles.push(
      await NestlyLink.addListener('rx', (e) => this.receive(fromBase64(e.data))),
    )
    this.handles.push(
      await NestlyLink.addListener('state', (e) => {
        this.setStatus({
          state: e.state as never,
          detail: e.detail,
          peer: e.state === 'connected' ? { id: e.detail ?? 'parent', name: 'Parent phone' } : undefined,
        })
      }),
    )

    this.beginSweep()
    await NestlyLink.start({ name: this.deviceName })
  }

  async stop() {
    for (const h of this.handles) await h.remove()
    this.handles = []
    this.endSweep()
    await NestlyLink.stop().catch(() => {})
    this.setStatus({ state: 'off', peer: undefined })
  }

  protected async writeChunk(chunk: Uint8Array) {
    // No subscriber means nobody is in range. That is the normal case for a
    // store-and-forward link, so it is not an error — the caller keeps the
    // message in the log and it goes out on the next contact.
    await NestlyLink.send({ data: toBase64(chunk) }).catch(() => {})
  }
}
