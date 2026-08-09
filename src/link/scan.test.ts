import { describe, expect, it } from 'vitest'
import { dedupe } from './ble-central'

/**
 * Regression cover for the pairing screen showing one phone twice — once under
 * the phone's own Bluetooth name and once as "Child device" — because the
 * advertisement and the scan response surfaced as separate results.
 */
describe('scan de-duplication', () => {
  it('collapses two results from the same child into one', () => {
    const out = dedupe([
      { id: 'AA:BB', name: 'Maya', rssi: -55, advertised: 'Maya' },
      { id: 'CC:DD', name: 'Maya', rssi: -70, advertised: 'Maya' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Maya')
  })

  it('keeps the strongest signal of a collapsed pair', () => {
    const out = dedupe([
      { id: 'weak', name: 'Maya', rssi: -90, advertised: 'Maya' },
      { id: 'strong', name: 'Maya', rssi: -40, advertised: 'Maya' },
    ])
    expect(out[0].id).toBe('strong')
  })

  it('keeps genuinely different children apart', () => {
    const out = dedupe([
      { id: '1', name: 'Maya', rssi: -50, advertised: 'Maya' },
      { id: '2', name: 'Leo', rssi: -60, advertised: 'Leo' },
    ])
    expect(out.map((p) => p.name).sort()).toEqual(['Leo', 'Maya'])
  })

  it('drops unnamed results when a named one is present', () => {
    // The unnamed entry is the advertisement half of the same phone.
    const out = dedupe([
      { id: 'AA:BB', name: "Joe's A54", rssi: -60 },
      { id: 'AA:BB', name: 'Maya', rssi: -58, advertised: 'Maya' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Maya')
  })

  it('still lists unnamed devices when nothing advertises a name', () => {
    // An older child build that predates the manufacturer-data name.
    const out = dedupe([{ id: 'AA:BB', name: 'Child device', rssi: -60 }])
    expect(out).toHaveLength(1)
  })

  it('sorts by signal strength, strongest first', () => {
    const out = dedupe([
      { id: '1', name: 'Far', rssi: -85, advertised: 'Far' },
      { id: '2', name: 'Near', rssi: -35, advertised: 'Near' },
    ])
    expect(out.map((p) => p.name)).toEqual(['Near', 'Far'])
  })
})
