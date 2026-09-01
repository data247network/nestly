export type ScreenId =
  | 'onboard1' | 'onboard2' | 'onboard3' | 'login' | 'addChild' | 'enrollDevice'
  | 'home' | 'v2control' | 'map' | 'geofence' | 'screentime' | 'scenario' | 'activity' | 'trail' | 'contacts' | 'alerts' | 'acoustic' | 'hub' | 'tips' | 'report'
  | 'roleGate' | 'pair' | 'childSetup' | 'plans' | 'household'
  | 'childHome' | 'childLock' | 'childNotice' | 'webOverview' | 'webSplit' | 'paywall'

export type Surface = 'parent' | 'child' | 'web'
export type Tone = 'teal' | 'amber' | 'coral' | 'violet'
export type Child = { id:string; source?:'ble'|'cloud'; name:string; age:number; avatar:string; status:string; statusTone:Tone; screenMinutes:number; battery:number; trend:number[] }
export type Geofence = { id:string; childIds:string[]; name:string; lat:number; lng:number; radiusM:number; notifyArrive:boolean; notifyLeave:boolean }
export type Scenario = { id:string; name:string; days:number[]; fromMin:number; toMin:number; enabled:boolean; blocks:{games:boolean;social:boolean;messaging:boolean} }
export type AlertKind = 'location'|'content'|'sound'|'contact'
export type Alert = { id:string; kind:AlertKind; title:string; who:string; ts:number; childId:string; tone:Tone; urgent?:boolean }
export type ActivityEntry = { seq:number; ts:number; kind:string; ref?:string; childId:string }
export type Message = { id:string; from:'parent'|'child'; text:string }
export type AppUsage = { app:string; minutes:number; tone:Tone }
export type { Filters } from '../link/protocol'
