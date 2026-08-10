import type { ScreenId, Surface } from './types'

/**
 * The screen registry. Mirrors the groups in the source design file so the
 * showcase sidebar and the app's own routing stay in step.
 */
export const NAV_GROUPS: { name: string; surface: Surface; items: ScreenId[] }[] = [
  { name: 'Onboarding', surface: 'parent', items: ['onboard1', 'onboard2', 'onboard3', 'login'] },
  { name: 'Setup', surface: 'parent', items: ['addChild', 'enrollDevice'] },
  {
    name: 'Parent App',
    surface: 'parent',
    items: [
      'home',
      'map',
      'geofence',
      'screentime',
      'scenario',
      'activity',
      'trail',
      'contacts',
      'alerts',
      'acoustic',
      'hub',
      'report',
      'tips',
    ],
  },
  {
    name: 'Setup',
    surface: 'parent',
    items: ['roleGate', 'household', 'pair', 'childSetup', 'plans'],
  },
  { name: 'Child Device', surface: 'child', items: ['childHome', 'childLock', 'childNotice'] },
  { name: 'Web Dashboard', surface: 'web', items: ['webOverview', 'webSplit'] },
  { name: 'Plans', surface: 'web', items: ['paywall'] },
]

export const LABELS: Record<ScreenId, string> = {
  onboard1: 'Flash card 1',
  onboard2: 'Flash card 2',
  onboard3: 'Flash card 3',
  login: 'Sign in',
  addChild: 'Add child',
  enrollDevice: 'Enroll device',
  roleGate: 'Choose device role',
  pair: 'Devices',
  childSetup: 'Child device settings',
  household: 'Family Hub',
  plans: 'Plans',
  report: 'Reports',
  childHome: 'Child home',
  home: 'Home',
  map: 'Map & geofences',
  geofence: 'New geofence',
  screentime: 'Screen time',
  scenario: 'Scenario editor',
  activity: 'Web & apps',
  trail: 'Activity trail',
  contacts: 'Emergency contacts',
  alerts: 'Alerts feed',
  acoustic: 'Acoustic alert',
  hub: 'Family hub',
  tips: 'Safety tips',
  childLock: 'Lock screen',
  childNotice: 'Transparency notice',
  webOverview: 'Overview',
  webSplit: 'Map & activity',
  paywall: 'Plans & billing',
}

/** Screens that render inside the desktop browser chrome rather than a phone. */
export const WEB_SCREENS: ScreenId[] = ['webOverview', 'webSplit', 'paywall']

export const ALL_SCREENS: ScreenId[] = NAV_GROUPS.flatMap((g) => g.items)

const CHILD_SCREENS: ScreenId[] = ['childHome', 'childLock', 'childNotice']

export function surfaceOf(id: ScreenId): Surface {
  if (WEB_SCREENS.includes(id)) return 'web'
  if (CHILD_SCREENS.includes(id)) return 'child'
  return 'parent'
}

/**
 * Screens reachable from the parent app's bottom tab bar. Everything else is
 * pushed on top of one of these.
 */
/**
 * Six tabs, which is one more than is comfortable but fewer than the number of
 * things a parent actually needs at the top level. Alerts loses its slot and
 * lives under Home, where the recent ones already appear with a "See all" —
 * every other tab is a place you go deliberately, whereas alerts find you.
 */
export const TABS: { id: ScreenId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'map', label: 'Map' },
  { id: 'screentime', label: 'Limits' },
  { id: 'hub', label: 'Hub' },
  { id: 'report', label: 'Reports' },
  { id: 'pair', label: 'Devices' },
]
