import { describe, expect, it } from 'vitest'
import { INITIAL, reducer } from './store'
import type { State } from './store'

/**
 * The two reducer changes that let the cloud fill the same screens Bluetooth
 * fills. Both fail *silently* when wrong — one empties a parent's history a
 * second after it loads, the other shows every alert two and three times — so
 * they are pinned rather than left to be noticed in use.
 */

const child = (id: string, source?: 'ble' | 'cloud') => ({
  id,
  ...(source ? { source } : {}),
  name: id,
  age: 10,
  avatar: '#147D77',
  status: '',
  statusTone: 'teal' as const,
  screenMinutes: 0,
  battery: 100,
  trend: [0, 0, 0, 0, 0],
})

const base = (children: ReturnType<typeof child>[]): State => ({
  ...INITIAL,
  children,
  activeChildId: children[0]?.id ?? '',
})

describe('cloud children and the Bluetooth prune', () => {
  it('keeps a cloud child the radio has never seen', () => {
    // The Bluetooth reconcile is driven by the pairing list. A child enrolled
    // online but never paired is not stale, and deleting it here is what made
    // the cloud history vanish the instant it arrived.
    const before = base([child('peer-1'), child('cloud-1', 'cloud')])
    const after = reducer(before, { type: 'reconcileChildren', validIds: ['peer-1'] })

    expect(after.children.map((c) => c.id).sort()).toEqual(['cloud-1', 'peer-1'])
  })

  it('still prunes a Bluetooth child that is no longer paired', () => {
    const before = base([child('peer-1'), child('ghost')])
    const after = reducer(before, { type: 'reconcileChildren', validIds: ['peer-1'] })

    expect(after.children.map((c) => c.id)).toEqual(['peer-1'])
  })

  it('replaces cloud children without disturbing paired ones', () => {
    const before = base([child('peer-1'), child('cloud-1', 'cloud')])
    const after = reducer(before, {
      type: 'syncCloudChildren',
      children: [{ id: 'cloud-2', name: 'Ada', avatar: '#000' }],
    })

    const ids = after.children.map((c) => c.id).sort()
    expect(ids).toEqual(['cloud-2', 'peer-1'])
  })

  it('keeps live figures when a cloud child is refreshed', () => {
    // The poll runs every 15s. Rebuilding the row each time would blank the
    // battery and status the screens had already filled in.
    const existing = { ...child('cloud-1', 'cloud'), battery: 42, screenMinutes: 90 }
    const after = reducer(base([existing]), {
      type: 'syncCloudChildren',
      children: [{ id: 'cloud-1', name: 'Renamed', avatar: '#fff' }],
    })

    const c = after.children.find((x) => x.id === 'cloud-1')
    expect(c?.battery).toBe(42)
    expect(c?.screenMinutes).toBe(90)
    expect(c?.name).toBe('Renamed')
  })

  it('does not churn state when nothing changed', () => {
    // Referential equality matters: a new object every poll re-renders every
    // screen reading the store, fifteen seconds apart, forever.
    const before = base([child('cloud-1', 'cloud')])
    const after = reducer(before, {
      type: 'syncCloudChildren',
      children: [{ id: 'cloud-1', name: 'cloud-1', avatar: '#147D77' }],
    })

    expect(after).toBe(before)
  })
})

describe('ingesting the same event from both links', () => {
  const events = [{ seq: 1, ts: 1000, kind: 'zone-leave', ref: 'School' }]

  it('records one alert, not one per delivery', () => {
    const first = reducer(base([child('c1')]), {
      type: 'ingestEvents',
      childId: 'c1',
      events,
    })
    expect(first.alerts).toHaveLength(1)
    expect(first.activity).toHaveLength(1)

    // Same event, now arriving over the other link.
    const second = reducer(first, { type: 'ingestEvents', childId: 'c1', events })
    expect(second.alerts).toHaveLength(1)
    expect(second.activity).toHaveLength(1)
  })

  it('still records genuinely new events', () => {
    const first = reducer(base([child('c1')]), { type: 'ingestEvents', childId: 'c1', events })
    const second = reducer(first, {
      type: 'ingestEvents',
      childId: 'c1',
      events: [{ seq: 2, ts: 2000, kind: 'zone-enter', ref: 'Home' }],
    })

    expect(second.activity).toHaveLength(2)
    expect(second.alerts).toHaveLength(2)
  })

  it('keeps sequence numbers scoped per child', () => {
    // Two children both start at seq 1. Keyed globally, the second child's
    // whole history would be discarded as already seen.
    const start = base([child('c1'), child('c2')])
    const first = reducer(start, { type: 'ingestEvents', childId: 'c1', events })
    const second = reducer(first, { type: 'ingestEvents', childId: 'c2', events })

    expect(second.activity).toHaveLength(2)
  })
})
