import { BleClient, numbersToDataView, type ScanResult } from '@capacitor-community/bluetooth-le'
import { CHAR_DOWNLINK, CHAR_UPLINK, SERVICE_UUID } from './protocol'
import { BaseTransport, type Peer, type Transport } from './transport'

/**
 * The parent device's side of the link.
 *
 * Scans only for SERVICE_UUID, so the pairing list shows Nestly child devices
 * rather than every headset and fitness band in the house. Once connected it
 * subscribes to the uplink characteristic and writes policy to the downlink one.
 */
export class BleCentralTransport extends BaseTransport implements Transport {
  readonly kind = 'ble-central' as const
  private deviceId?: string
  private initialised = false
  /** Consecutive failed connects, used to decide when to go looking again. */
  private misses = 0

  /**
   * @param rememberedDeviceId last known BLE address
   * @param expectedName       the name the child advertises, which is stable
   * @param onAddressChanged   called when the child is found at a new address
   */
  constructor(
    rememberedDeviceId?: string,
    private expectedName?: string,
    private onAddressChanged?: (deviceId: string) => void,
  ) {
    super()
    this.deviceId = rememberedDeviceId
    this.chunkSize = 20
  }

  /**
   * Finds the paired child at whatever address it is using now.
   *
   * Android advertises with a *resolvable private address* that rotates every
   * few minutes for privacy. The address we paired with therefore stops
   * existing, and every reconnect to it fails forever — the link looks dead
   * even with both phones on the same table.
   *
   * Bonding would let the stack resolve the rotation for us, but it puts a
   * system pairing dialog in front of a parent mid-setup. Instead we re-scan
   * for our own service UUID and match on the name the child advertises, which
   * does not rotate, then remember the new address.
   */
  private async rediscover(ms = 6000): Promise<string | null> {
    const peers = await this.scan(ms).catch(() => [] as Peer[])
    if (peers.length === 0) return null

    // Prefer an exact name match; fall back to the only candidate when there is
    // just one, since a lone Nestly child device in range is almost certainly
    // ours and a stuck link is worse than a rare mispair.
    const byName = this.expectedName
      ? peers.find((p) => p.name === this.expectedName)
      : undefined
    const found = byName ?? (peers.length === 1 ? peers[0] : undefined)
    if (!found || found.id === this.deviceId) return null

    this.deviceId = found.id
    this.onAddressChanged?.(found.id)
    return found.id
  }

  private async init() {
    if (this.initialised) return
    await BleClient.initialize({ androidNeverForLocation: true })
    this.initialised = true
  }

  async start() {
    this.setStatus({ state: 'starting' })
    try {
      await this.init()
    } catch (e) {
      this.setStatus({ state: 'error', detail: describe(e) })
      return
    }

    if (!this.deviceId) {
      // Nothing paired yet — the pairing screen drives scan()/connectTo().
      this.setStatus({ state: 'scanning', detail: 'No child device paired yet.' })
      return
    }
    await this.connectTo(this.deviceId)
  }

  async scan(ms: number): Promise<Peer[]> {
    await this.init()
    const found = new Map<string, Peer & { advertised?: string }>()
    this.setStatus({ state: 'scanning' })

    await BleClient.requestLEScan({ services: [SERVICE_UUID] }, (r: ScanResult) => {
      const advertised = readAdvertisedName(r)
      const prev = found.get(r.device.deviceId)
      found.set(r.device.deviceId, {
        id: r.device.deviceId,
        // The advertised name is the child's own; r.device.name is the phone's
        // Bluetooth name, which is a poor last resort but better than nothing.
        name: advertised ?? prev?.advertised ?? r.device.name ?? r.localName ?? 'Child device',
        rssi: r.rssi ?? prev?.rssi,
        advertised: advertised ?? prev?.advertised,
      })
    })
    await new Promise((r) => setTimeout(r, ms))
    await BleClient.stopLEScan().catch(() => {})

    return dedupe([...found.values()])
  }

  async connectTo(deviceId: string) {
    await this.init()
    this.deviceId = deviceId
    this.setStatus({ state: 'connecting' })

    try {
      await BleClient.connect(deviceId, () => {
        // Fired on disconnect. The child is simply out of range most of the
        // day, so this is expected rather than exceptional.
        this.setStatus({ state: 'scanning', detail: 'Not in range right now', peer: undefined })
        this.scheduleRetry()
      })

      // The plugin negotiates MTU itself on Android; there is no request API to
      // call. Read it back so chunking can use whatever we actually got —
      // falling back to the conservative 20 bytes if the read fails.
      const mtu = await BleClient.getMtu(deviceId).catch(() => 23)
      this.chunkSize = Math.max(20, Math.min(180, mtu - 3))

      await BleClient.startNotifications(deviceId, SERVICE_UUID, CHAR_UPLINK, (value) => {
        this.receive(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)))
      })

      this.misses = 0
      this.beginSweep()
      this.setStatus({
        state: 'connected',
        peer: { id: deviceId, name: this.expectedName ?? 'Child device' },
        detail: undefined,
      })
    } catch (e) {
      // A failed connect is the *normal* state for this product — the child is
      // at school, or the phone is in a bag. Reporting it as an error put a red
      // banner on the parent's home screen for most of the day. Only genuine
      // faults (Bluetooth off, permission refused) are errors.
      const fault = permanentFault(e)
      this.setStatus(
        fault
          ? { state: 'error', detail: fault }
          : { state: 'scanning', detail: 'Not in range right now', peer: undefined },
      )
      this.scheduleRetry()
    }
  }

  /**
   * Keeps trying in the background so the link comes back on its own when the
   * child walks in, instead of waiting for the parent to open the pairing
   * screen.
   */
  private retry?: ReturnType<typeof setTimeout>

  private scheduleRetry() {
    if (this.retry || !this.deviceId) return
    this.retry = setTimeout(() => {
      this.retry = undefined
      if (this.status().state === 'connected' || !this.deviceId) return

      void (async () => {
        this.misses += 1
        // Two straight failures usually means the address rotated rather than
        // the child being out of range, so go looking instead of retrying a
        // dead address forever. Scanning costs battery, hence not every time.
        if (this.misses >= 2) {
          this.misses = 0
          const moved = await this.rediscover(4000)
          if (moved) {
            await this.connectTo(moved)
            return
          }
        }
        await this.connectTo(this.deviceId!)
      })()
    }, 30_000)
  }

  /**
   * Forces an immediate reconnect attempt.
   *
   * The stale GATT client is closed first: Android caches a failed connection
   * and a bare re-connect on the same handle frequently returns status 133
   * forever, which is exactly the stuck state this button exists to clear.
   */
  async reconnect() {
    if (!this.deviceId) return
    if (this.retry) clearTimeout(this.retry)
    this.retry = undefined

    this.setStatus({ state: 'connecting', detail: 'Reconnecting…' })
    await BleClient.stopNotifications(this.deviceId, SERVICE_UUID, CHAR_UPLINK).catch(() => {})
    await BleClient.disconnect(this.deviceId).catch(() => {})

    await this.connectTo(this.deviceId)
    if (this.status().state === 'connected') return

    // The stored address may simply no longer exist. Go and find them.
    this.setStatus({ state: 'scanning', detail: 'Looking for their phone…' })
    const moved = await this.rediscover()
    if (moved) await this.connectTo(moved)
  }

  async stop() {
    this.endSweep()
    if (this.retry) clearTimeout(this.retry)
    this.retry = undefined
    if (this.deviceId) {
      await BleClient.stopNotifications(this.deviceId, SERVICE_UUID, CHAR_UPLINK).catch(() => {})
      await BleClient.disconnect(this.deviceId).catch(() => {})
    }
    this.setStatus({ state: 'off', peer: undefined })
  }

  protected async writeChunk(chunk: Uint8Array) {
    if (!this.deviceId || this.status().state !== 'connected') return
    await BleClient.writeWithoutResponse(
      this.deviceId,
      SERVICE_UUID,
      CHAR_DOWNLINK,
      numbersToDataView(Array.from(chunk)),
    ).catch(() => {
      // Dropped write: the policy carries a version number, so the child will
      // be brought up to date on the next contact rather than losing it.
    })
  }
}

/** 0xFFFF — the reserved company id the child advertises its name under. */
const MANUFACTURER_KEY = '65535'

function readAdvertisedName(r: ScanResult): string | undefined {
  const view = r.manufacturerData?.[MANUFACTURER_KEY]
  if (!view || view.byteLength === 0) return undefined
  try {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim()
    return text.length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * Collapses the scan list to one entry per physical child device.
 *
 * A single phone routinely produces two results — the advertisement and the
 * scan response arrive separately, and Android's address randomisation can put
 * them under different ids. Grouping on the advertised name is what turns that
 * back into one row the parent can actually choose. Devices that never sent a
 * name are kept, but only when nothing named is offering the same slot.
 */
export function dedupe(peers: (Peer & { advertised?: string })[]): Peer[] {
  const byName = new Map<string, Peer>()
  const unnamed: Peer[] = []

  for (const p of peers) {
    const entry: Peer = { id: p.id, name: p.name, rssi: p.rssi }
    if (!p.advertised) {
      unnamed.push(entry)
      continue
    }
    const existing = byName.get(p.advertised)
    // Keep whichever address is currently louder; it is the one most likely to
    // connect first time.
    if (!existing || (entry.rssi ?? -999) > (existing.rssi ?? -999)) {
      byName.set(p.advertised, entry)
    }
  }

  const named = [...byName.values()]
  const merged = named.length > 0 ? named : unnamed
  return merged.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
}

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/not enabled|disabled/i.test(msg)) return 'Turn Bluetooth on to connect.'
  if (/permission/i.test(msg)) return 'Bluetooth permission is needed to connect.'
  return msg || 'Bluetooth error'
}

/**
 * Distinguishes something the parent must fix from something that will resolve
 * itself. Timeouts, "device not found" and disconnects are just distance.
 */
function permanentFault(e: unknown): string | null {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
  if (/not enabled|disabled|turn.*on/.test(msg)) return 'Turn Bluetooth on to connect.'
  if (/permission/.test(msg)) return 'Bluetooth permission is needed to connect.'
  if (/timeout|not found|unreachable|disconnect|133|failed to connect/.test(msg)) return null
  return describe(e)
}
