import { describe, expect, it } from 'vitest'
import { childRenderScreen, childScreenFor } from './nav'

/**
 * `App.tsx` once rendered `childHome` unconditionally for role === 'child',
 * ignoring `state.screen` entirely. Every `go('childChores')` (or any other
 * child navigation, including the route to the in-app lock screen) updated the
 * store correctly and nothing ever read it — a tap that worked, driving a
 * screen that never changed, indistinguishable from a dead button. Pinned here
 * so the fix cannot silently regress back to a hardcoded screen.
 */
describe('childScreenFor', () => {
  it('follows a real child screen', () => {
    expect(childScreenFor('childChores')).toBe('childChores')
    expect(childScreenFor('childRoutines')).toBe('childRoutines')
    expect(childScreenFor('childRequests')).toBe('childRequests')
    expect(childScreenFor('childRewards')).toBe('childRewards')
    expect(childScreenFor('childHub')).toBe('childHub')
    expect(childScreenFor('childLock')).toBe('childLock')
    expect(childScreenFor('childNotice')).toBe('childNotice')
  })

  it('falls back to childHome for anything that is not a child screen', () => {
    // A parent-only id left over from switching a device's role, or a screen
    // that predates a child device entirely, must not render on a child phone.
    expect(childScreenFor('v2control')).toBe('childHome')
    expect(childScreenFor('screentime')).toBe('childHome')
    expect(childScreenFor('paywall')).toBe('childHome')
  })
})

/**
 * `agent.locked` used to only gate the legacy, now-unreachable `ChildHome`.
 * A device whose native overlay failed to apply (permission revoked or never
 * granted) showed whatever `state.screen` said — indistinguishable from an
 * unlocked phone. Locked must always win, regardless of navigation.
 */
describe('childRenderScreen', () => {
  it('forces the lock screen whenever locked, regardless of state.screen', () => {
    expect(childRenderScreen('childChores', true)).toBe('childLock')
    expect(childRenderScreen('childHome', true)).toBe('childLock')
    expect(childRenderScreen('v2control', true)).toBe('childLock')
  })

  it('falls through to childScreenFor when not locked', () => {
    expect(childRenderScreen('childChores', false)).toBe('childChores')
    expect(childRenderScreen('v2control', false)).toBe('childHome')
  })
})
