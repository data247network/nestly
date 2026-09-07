import type { ScreenId, Surface } from './types'

export const NAV_GROUPS: { name: string; surface: Surface; items: ScreenId[] }[] = [
  { name: 'Onboarding', surface: 'parent', items: ['onboard1', 'onboard2', 'onboard3', 'login'] },
  { name: 'Setup', surface: 'parent', items: ['addChild', 'enrollDevice', 'roleGate', 'household', 'pair', 'childSetup', 'plans'] },
  { name: 'Parent App', surface: 'parent', items: ['v2control', 'schoolModeV2', 'choresV2', 'map', 'screentime', 'scenario', 'activity', 'trail', 'contacts', 'alerts', 'hub', 'report'] },
  { name: 'Child Device', surface: 'child', items: ['childHome', 'childRoutines', 'childRequests', 'childRewards', 'childChores', 'childLock', 'childNotice'] },
  { name: 'Web Dashboard', surface: 'web', items: ['webOverview', 'webSplit'] },
  { name: 'Plans', surface: 'web', items: ['paywall'] },
]

export const LABELS: Record<ScreenId, string> = {
  onboard1: 'Flash card 1', onboard2: 'Flash card 2', onboard3: 'Flash card 3', login: 'Sign in', addChild: 'Add child', enrollDevice: 'Enroll device', roleGate: 'Choose device role', pair: 'Devices', childSetup: 'Child device settings', household: 'Family Hub', plans: 'Plans', report: 'Reports',
  v2control: 'Control centre', home: 'Control centre', schoolModeV2: 'School Mode', choresV2: 'Chores & rewards', map: 'Map & safe zones', geofence: 'New safe zone', screentime: 'Screen time', scenario: 'School mode & routines', activity: 'Web & apps', trail: 'Activity trail', contacts: 'Emergency contacts', alerts: 'Alerts', acoustic: 'Acoustic alert', hub: 'Family hub', tips: 'Safety tips',
  childHome: 'Child home', childRoutines: 'My routines', childRequests: 'My requests', childRewards: 'My rewards', childChores: 'My chores', childLock: 'Lock screen', childNotice: 'Transparency notice', webOverview: 'Overview', webSplit: 'Map & activity', paywall: 'Plans & billing',
}

export const WEB_SCREENS: ScreenId[] = ['webOverview', 'webSplit', 'paywall']
export const ALL_SCREENS: ScreenId[] = NAV_GROUPS.flatMap((g) => g.items)
export const CHILD_SCREENS: ScreenId[] = ['childHome', 'childRoutines', 'childRequests', 'childRewards', 'childChores', 'childLock', 'childNotice']
export function surfaceOf(id: ScreenId): Surface { if (WEB_SCREENS.includes(id)) return 'web'; if (CHILD_SCREENS.includes(id)) return 'child'; return 'parent' }

/**
 * What to actually render for a child device, given whatever `state.screen`
 * currently holds.
 *
 * Exists because `App.tsx` once rendered `childHome` unconditionally for every
 * child device, ignoring `state.screen` entirely — so `go('childChores')` (or
 * any other child navigation, including the route to the in-app lock screen)
 * updated the store correctly and nothing ever read it. Tapping the button
 * looked identical to the button being dead.
 *
 * Falls back to `childHome` for anything not in `CHILD_SCREENS`, so a
 * parent-only id left over from switching a device's role cannot leak through
 * and render the wrong surface on a child's phone.
 */
export function childScreenFor(screen: ScreenId): ScreenId {
  return CHILD_SCREENS.includes(screen) ? screen : 'childHome'
}
export const TABS: { id: ScreenId; label: string }[] = [
  { id: 'v2control', label: 'Home' }, { id: 'schoolModeV2', label: 'School' }, { id: 'map', label: 'Map' }, { id: 'screentime', label: 'Limits' }, { id: 'hub', label: 'Hub' }, { id: 'pair', label: 'Devices' },
]
