import { describe, expect, it } from 'vitest'
import { INITIAL, buildPolicy, reducer } from './store'
import type { State } from './store'
import type { Child } from './types'

/**
 * `reconcileChildren` deletes children, alerts and activity, so a mistake here
 * destroys real history rather than merely displaying it wrong. It exists
 * because children are persisted: a build that changes how they are keyed
 * leaves a ghost card that no unpair can ever clear.
 */

const child = (id: string, name = id): Child => ({
  id,
  name,
  age: 0,
  avatar: '#147D77',
  status: 'Location known',
  statusTone: 'teal',
  screenMinutes: 0,
  battery: 100,
  trend: [0, 0, 0, 0, 0],
})

function withChildren(ids: string[]): State {
  return {
    ...INITIAL,
    children: ids.map((id) => child(id)),
    activeChildId: ids[0] ?? '',
    activity: ids.map((id, i) => ({ seq: i + 1, ts: 1000 + i, kind: 'zone-enter', childId: id })),
    alerts: ids.map((id, i) => ({
      id: `a-${id}`,
      kind: 'location' as const,
      title: 'Arrived',
      who: id,
      time: '9:00',
      ts: 1000 + i,
      childId: id,
      tone: 'teal' as const,
    })),
    usageByChild: Object.fromEntries(
      ids.map((id) => [id, { apps: [], sites: [], day: '2026-01-01', usageAccess: true, filterOn: true }]),
    ),
  }
}

describe('reconcileChildren', () => {
  it('drops a ghost child that no pairing accounts for', () => {
    const before = withChildren(['ghost', 'real'])
    const after = reducer(before, { type: 'reconcileChildren', validIds: ['real'] })

    expect(after.children.map((c) => c.id)).toEqual(['real'])
    expect(after.activity.every((a) => a.childId === 'real')).toBe(true)
    expect(after.alerts.every((a) => a.childId === 'real')).toBe(true)
    expect(after.usageByChild.ghost).toBeUndefined()
    expect(after.usageByChild.real).toBeDefined()
  })

  it('moves the active child off one that was dropped', () => {
    const before = withChildren(['ghost', 'real'])
    expect(before.activeChildId).toBe('ghost')

    const after = reducer(before, { type: 'reconcileChildren', validIds: ['real'] })
    expect(after.activeChildId).toBe('real')
  })

  it('leaves the active child alone when it survives', () => {
    const before = { ...withChildren(['real', 'ghost']), activeChildId: 'real' }
    const after = reducer(before, { type: 'reconcileChildren', validIds: ['real'] })
    expect(after.activeChildId).toBe('real')
  })

  it('prunes a zone carrying a child id that no longer resolves', () => {
    // The exact shape seen on a real upgraded phone: the zone showed
    // "Everyone" in the UI but reached nobody, because buildPolicy filtered it
    // out for every child.
    const before: State = {
      ...withChildren(['real']),
      geofences: [
        {
          id: 'parlour',
          childIds: ['stale-key-from-old-build'],
          name: 'Parlour house',
          lat: 51.5,
          lng: -0.1,
          radiusM: 490,
          notifyArrive: true,
          notifyLeave: true,
        },
      ],
    }
    expect(buildPolicy(before, 'real').geofences).toHaveLength(0)

    const after = reducer(before, { type: 'reconcileChildren', validIds: ['real'] })
    expect(after.geofences[0].childIds).toEqual([])
    // Reverting to "everyone" is what makes it fire again.
    expect(buildPolicy(after, 'real').geofences).toHaveLength(1)
  })

  it('is a no-op when every child is accounted for', () => {
    const before = withChildren(['a', 'b'])
    // Identity, not just equality: an unchanged state must not re-render or
    // re-persist, and the effect that dispatches this runs on every load.
    expect(reducer(before, { type: 'reconcileChildren', validIds: ['a', 'b'] })).toBe(before)
  })

  it('clears everything when no pairings remain', () => {
    const before = withChildren(['a'])
    const after = reducer(before, { type: 'reconcileChildren', validIds: [] })

    expect(after.children).toEqual([])
    expect(after.activity).toEqual([])
    expect(after.alerts).toEqual([])
    expect(after.activeChildId).toBe('')
  })
})

/**
 * The merge in `childSeen` is what made the ghost visible, so pin its intended
 * behaviour: same device updates in place, different devices accumulate.
 */
/**
 * Restoring an older build's state must not leave a routine the child device
 * cannot evaluate — it showed up as "NaN:NaN AM" on the parent, and as a
 * schedule that silently never fired on the child.
 */
describe('restore migration', () => {
  it('converts legacy string times into minutes', () => {
    const legacy = {
      scenarios: [
        {
          id: 'church',
          name: 'Church',
          days: [6],
          from: '9:00 AM',
          to: '11:00 AM',
          enabled: false,
          blocks: { games: true, social: true, messaging: false },
        },
      ],
    } as unknown as Partial<State>

    const after = reducer(INITIAL, { type: 'restore', state: legacy })
    expect(after.scenarios[0].fromMin).toBe(9 * 60)
    expect(after.scenarios[0].toMin).toBe(11 * 60)
  })

  it('falls back to a usable window when the legacy times are missing too', () => {
    const broken = {
      scenarios: [
        {
          id: 'x',
          name: 'Broken',
          days: [0],
          enabled: true,
          blocks: { games: false, social: false, messaging: false },
        },
      ],
    } as unknown as Partial<State>

    const after = reducer(INITIAL, { type: 'restore', state: broken })
    expect(Number.isFinite(after.scenarios[0].fromMin)).toBe(true)
    expect(Number.isFinite(after.scenarios[0].toMin)).toBe(true)
  })

  it('leaves already-migrated scenarios untouched', () => {
    const after = reducer(INITIAL, { type: 'restore', state: { scenarios: INITIAL.scenarios } })
    expect(after.scenarios).toBe(INITIAL.scenarios)
  })
})

/**
 * Zone scoping decides what each child's phone actually receives. Getting it
 * wrong either leaks one child's places onto another's device, or silently
 * drops a zone so it never fires.
 */
describe('per-child zone scoping', () => {
  const fence = (id: string, childIds: string[]) => ({
    id,
    childIds,
    name: id,
    lat: 51.5,
    lng: -0.1,
    radiusM: 200,
    notifyArrive: true,
    notifyLeave: true,
  })

  const withFences = (): State => ({
    ...INITIAL,
    geofences: [fence('home', []), fence('school-a', ['a']), fence('club', ['a', 'b'])],
  })

  it('sends a child only the zones that name it, plus the household ones', () => {
    const policy = buildPolicy(withFences(), 'a')
    expect(policy.geofences.map((g) => g.id).sort()).toEqual(['club', 'home', 'school-a'])
  })

  it('does not leak another child’s zone', () => {
    const policy = buildPolicy(withFences(), 'b')
    expect(policy.geofences.map((g) => g.id).sort()).toEqual(['club', 'home'])
    expect(policy.geofences.some((g) => g.id === 'school-a')).toBe(false)
  })

  it('migrates a legacy single-child zone without widening it', () => {
    const legacy = {
      geofences: [{ ...fence('old', []), childId: 'a', childIds: undefined }],
    } as unknown as Partial<State>

    const after = reducer(INITIAL, { type: 'restore', state: legacy })
    expect(after.geofences[0].childIds).toEqual(['a'])
    // And it must not reach the other child.
    expect(buildPolicy(after, 'b').geofences).toHaveLength(0)
  })

  it('keeps a shared zone when one of its children is unpaired', () => {
    const after = reducer(withFences(), { type: 'forgetChild', childId: 'a' })
    const ids = after.geofences.map((g) => g.id).sort()
    expect(ids).toEqual(['club', 'home'])
    expect(after.geofences.find((g) => g.id === 'club')?.childIds).toEqual(['b'])
  })
})

describe('childSeen', () => {
  const seen = (deviceId: string, name: string, battery: number) =>
    ({
      type: 'childSeen',
      child: { deviceId, name },
      battery,
      locked: false,
      activeScenarioId: null,
      hasFix: true,
    }) as const

  it('updates in place rather than appending a duplicate', () => {
    const a = reducer(INITIAL, seen('dev-1', 'Eliora', 90))
    const b = reducer(a, seen('dev-1', 'Eliora', 71))

    expect(b.children).toHaveLength(1)
    expect(b.children[0].battery).toBe(71)
  })

  it('keeps two genuinely different devices', () => {
    const a = reducer(INITIAL, seen('dev-1', 'Eliora', 90))
    const b = reducer(a, seen('dev-2', 'Sam', 55))

    expect(b.children.map((c) => c.name)).toEqual(['Eliora', 'Sam'])
  })

  it('does not steal the active child from the first one paired', () => {
    const a = reducer(INITIAL, seen('dev-1', 'Eliora', 90))
    const b = reducer(a, seen('dev-2', 'Sam', 55))
    expect(b.activeChildId).toBe('dev-1')
  })
})
