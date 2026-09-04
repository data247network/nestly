import type { ScreenId } from './types'
import { AddChild, EnrollDevice, Onboarding } from '../screens/onboarding'
import { Login } from '../screens/login'
import { useDevice } from '../platform/device'
import { AcousticAlert, Alerts, MapZones, NewGeofence, SafetyTips, ScenarioEditor, ScreenTime } from '../screens/parent'
import { ActivityTrail } from '../screens/activity'
import { FamilyHub } from '../screens/hub'
import { EmergencyContacts } from '../screens/contacts'
import { Filtering } from '../screens/filtering'
import { ChildLock, ChildNotice } from '../screens/child'
import { ChildV2Home } from '../screens/ChildV2Home'
import { ChildRoutinesV2, ChildRequestsV2, ChildRewardsV2 } from '../screens/ChildV2'
import { SchoolModeV2 } from '../screens/SchoolModeV2'
import { ChildSetup, RoleGate } from '../screens/setup'
import { ActivityReport } from '../screens/report'
import { Household } from '../screens/household'
import { Plans } from '../screens/plans'
import { Paywall, WebOverview, WebSplit } from '../screens/web'
import { CloudFirstDevices } from '../screens/CloudFirstDevices'
import { ParentV2 } from '../screens/ParentV2'

// `home` is retained as a compatibility route for older persisted state and
// web fallbacks, but it intentionally renders the same canonical Architecture
// v2 dashboard as `v2control`. There must be one parent dashboard, not two.
const SCREENS: Record<ScreenId, () => JSX.Element> = {
  onboard1:()=> <Onboarding index={0}/>, onboard2:()=> <Onboarding index={1}/>, onboard3:()=> <Onboarding index={2}/>, login:LoginScreen,
  addChild:AddChild, enrollDevice:EnrollDevice, home:ParentV2, v2control:ParentV2,
  schoolModeV2:SchoolModeV2, map:MapZones, geofence:NewGeofence, screentime:ScreenTime, scenario:ScenarioEditor,
  activity:Filtering, trail:ActivityTrail, contacts:EmergencyContacts, alerts:Alerts, acoustic:AcousticAlert, hub:FamilyHub,
  tips:SafetyTips, roleGate:RoleGate, pair:CloudFirstDevices, childSetup:ChildSetup, household:Household, plans:Plans, report:ActivityReport,
  childHome:ChildV2Home, childRoutines:ChildRoutinesV2, childRequests:ChildRequestsV2, childRewards:ChildRewardsV2,
  childLock:ChildLock, childNotice:ChildNotice, webOverview:WebOverview, webSplit:WebSplit, paywall:Paywall,
}

function LoginScreen(){const {signIn}=useDevice();return <Login onSignedIn={signIn}/>}
export function Screen({id}:{id:ScreenId}){const C=SCREENS[id];return <C/>}
