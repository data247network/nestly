import { describe, expect, it } from 'vitest'
import { INITIAL, buildPolicy, reducer } from './store'
import type { State } from './store'

/**
 * Per-app time caps / lock / PEGI: the reducer side of the feature the
 * handover flagged as having zero backend or frontend anywhere. Mirrors the
 * existing geofence tests' shape — same per-child-or-global convention, same
 * upsert-by-key pattern.
 */

describe('setAppRule', () => {
  it('creates a rule covering every child when none exists yet', () => {
    const next = reducer(INITIAL, {
      type: 'setAppRule',
      pkg: 'com.roblox.client',
      label: 'Roblox',
      patch: { capMinutes: 60 },
    })
    expect(next.appRules).toEqual([
      { pkg: 'com.roblox.client', childIds: [], label: 'Roblox', capMinutes: 60 },
    ])
  })

  it('merges into an existing rule rather than duplicating it', () => {
    const withRule: State = {
      ...INITIAL,
      appRules: [{ pkg: 'com.roblox.client', childIds: [], label: 'Roblox', capMinutes: 60 }],
    }
    const next = reducer(withRule, {
      type: 'setAppRule',
      pkg: 'com.roblox.client',
      patch: { locked: true },
    })
    expect(next.appRules).toHaveLength(1)
    expect(next.appRules[0]).toEqual({
      pkg: 'com.roblox.client',
      childIds: [],
      label: 'Roblox',
      capMinutes: 60,
      locked: true,
    })
  })

  it('bumps the policy version, so the child adopts the new rule', () => {
    const next = reducer(INITIAL, {
      type: 'setAppRule',
      pkg: 'com.roblox.client',
      patch: { locked: true },
    })
    expect(next.policyVersion).toBe(INITIAL.policyVersion + 1)
  })
})

describe('toggleAppRuleChild and removeAppRule', () => {
  const withRule: State = {
    ...INITIAL,
    appRules: [{ pkg: 'com.roblox.client', childIds: [], locked: true }],
  }

  it('scopes a rule to one child, then back to every child', () => {
    const scoped = reducer(withRule, { type: 'toggleAppRuleChild', pkg: 'com.roblox.client', childId: 'kid-1' })
    expect(scoped.appRules[0].childIds).toEqual(['kid-1'])

    const unscoped = reducer(scoped, { type: 'toggleAppRuleChild', pkg: 'com.roblox.client', childId: 'kid-1' })
    expect(unscoped.appRules[0].childIds).toEqual([])
  })

  it('removes a rule outright', () => {
    const next = reducer(withRule, { type: 'removeAppRule', pkg: 'com.roblox.client' })
    expect(next.appRules).toEqual([])
  })
})

describe('setMaxPegi', () => {
  it('stores the household threshold and null clears it', () => {
    const set = reducer(INITIAL, { type: 'setMaxPegi', value: 12 })
    expect(set.maxPegi).toBe(12)
    const cleared = reducer(set, { type: 'setMaxPegi', value: null })
    expect(cleared.maxPegi).toBeNull()
  })
})

describe('buildPolicy appRules', () => {
  const state: State = {
    ...INITIAL,
    maxPegi: 12,
    appRules: [
      { pkg: 'com.global.app', childIds: [], capMinutes: 30 },
      { pkg: 'com.kid1.app', childIds: ['kid-1'], locked: true },
      { pkg: 'com.kid2.app', childIds: ['kid-2'], locked: true },
    ],
  }

  it('sends a global rule (empty childIds) to every child', () => {
    const policy = buildPolicy(state, 'kid-1')
    expect(policy.appRules?.map((r) => r.pkg)).toContain('com.global.app')
  })

  it('scopes a per-child rule to only that child, same as geofences', () => {
    const forKid1 = buildPolicy(state, 'kid-1')
    expect(forKid1.appRules?.map((r) => r.pkg)).toEqual(['com.global.app', 'com.kid1.app'])

    const forKid2 = buildPolicy(state, 'kid-2')
    expect(forKid2.appRules?.map((r) => r.pkg)).toEqual(['com.global.app', 'com.kid2.app'])
  })

  it('carries the household maxPegi threshold when set', () => {
    expect(buildPolicy(state).maxPegi).toBe(12)
    expect(buildPolicy(INITIAL).maxPegi).toBeUndefined()
  })
})
