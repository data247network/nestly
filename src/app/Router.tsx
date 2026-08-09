import type { ScreenId } from './types'
import { AddChild, EnrollDevice, Onboarding, SignIn } from '../screens/onboarding'
import {
  AcousticAlert,
  Alerts,
  Home,
  MapZones,
  NewGeofence,
  SafetyTips,
  ScenarioEditor,
  ScreenTime,
} from '../screens/parent'
import { ActivityTrail } from '../screens/activity'
import { FamilyHub } from '../screens/hub'
import { EmergencyContacts } from '../screens/contacts'
import { Filtering } from '../screens/filtering'
import { ChildHome, ChildLock, ChildNotice } from '../screens/child'
import { ChildSetup, PairChild, RoleGate } from '../screens/setup'
import { ActivityReport } from '../screens/report'
import { Plans } from '../screens/plans'
import { Paywall, WebOverview, WebSplit } from '../screens/web'

const SCREENS: Record<ScreenId, () => JSX.Element> = {
  onboard1: () => <Onboarding index={0} />,
  onboard2: () => <Onboarding index={1} />,
  onboard3: () => <Onboarding index={2} />,
  login: SignIn,
  addChild: AddChild,
  enrollDevice: EnrollDevice,
  home: Home,
  map: MapZones,
  geofence: NewGeofence,
  screentime: ScreenTime,
  scenario: ScenarioEditor,
  activity: Filtering,
  trail: ActivityTrail,
  contacts: EmergencyContacts,
  alerts: Alerts,
  acoustic: AcousticAlert,
  hub: FamilyHub,
  tips: SafetyTips,
  roleGate: RoleGate,
  pair: () => <PairChild />,
  childSetup: ChildSetup,
  plans: Plans,
  report: ActivityReport,
  childHome: ChildHome,
  childLock: ChildLock,
  childNotice: ChildNotice,
  webOverview: WebOverview,
  webSplit: WebSplit,
  paywall: Paywall,
}

export function Screen({ id }: { id: ScreenId }) {
  const C = SCREENS[id]
  return <C />
}
