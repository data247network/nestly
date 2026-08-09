import { Capacitor } from '@capacitor/core'
import { BleCentralTransport } from './ble-central'
import { BlePeripheralTransport } from './ble-peripheral'
import { LoopbackTransport } from './loopback'
import type { Transport } from './transport'

export * from './protocol'
export * from './transport'

/**
 * Picks the link implementation for this device.
 *
 * Native gets the real radio. Everything else gets the BroadcastChannel
 * loopback, which speaks the identical framed protocol — so the whole
 * parent/child flow can be driven in two browser tabs during development,
 * rather than needing two phones to change a line of UI.
 */
export function createTransport(
  role: 'parent' | 'child',
  options: {
    deviceName: string
    pairedDeviceId?: string
    /** The name the paired child advertises — how it is found again after
     *  Android rotates its BLE address. */
    pairedName?: string
    onAddressChanged?: (deviceId: string) => void
  } = { deviceName: 'Nestly' },
): Transport {
  if (!Capacitor.isNativePlatform()) {
    return new LoopbackTransport(role)
  }
  return role === 'child'
    ? new BlePeripheralTransport(options.deviceName)
    : new BleCentralTransport(
        options.pairedDeviceId,
        options.pairedName,
        options.onAddressChanged,
      )
}
