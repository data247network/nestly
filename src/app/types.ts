export type ScreenId =
  // Onboarding — the three flash cards plus sign-in
  | 'onboard1'
  | 'onboard2'
  | 'onboard3'
  | 'login'
  // Setup
  | 'addChild'
  | 'enrollDevice'
  // Version 1 — the parent app
  | 'home'
  | 'map'
  | 'geofence'
  | 'screentime'
  | 'scenario'
  | 'activity'
  | 'trail'
  | 'contacts'
  | 'alerts'
  | 'acoustic'
  | 'hub'
  | 'tips'
  | 'report'
  // Setup, once per device
  | 'roleGate'
  | 'pair'
  /** Per-child settings, opened by tapping a device in the Device tab. */
  | 'childSetup'
  | 'plans'
  | 'household'
  // Version 2 — the child device
  | 'childHome'
  | 'childLock'
  | 'childNotice'
  // Version 3 — the web dashboard
  | 'webOverview'
  | 'webSplit'
  | 'paywall'

/** Which of the three product surfaces a screen belongs to. */
export type Surface = 'parent' | 'child' | 'web'

export type Tone = 'teal' | 'amber' | 'coral' | 'violet'

export type Child = {
  id: string
  /**
   * Which link this child came from.
   *
   * Absent means Bluetooth, which is every child that existed before the cloud
   * did — so persisted state from an older build keeps its meaning without a
   * migration. It matters because the two links prune independently: the BLE
   * reconcile must not delete a child it has simply never seen over the radio,
   * and the cloud sync must not delete one that is paired but not enrolled.
   */
  source?: 'ble' | 'cloud'
  name: string
  age: number
  avatar: string
  status: string
  statusTone: Tone
  screenMinutes: number
  battery: number
  /** Five-day screen-time trend, in minutes, used by the web dashboard chart. */
  trend: number[]
}

export type Geofence = {
  id: string
  /**
   * Which children this zone applies to. A list because most real zones —
   * home, school, grandma's — cover more than one child, and making the parent
   * draw the same circle once per child is busywork.
   *
   * Empty means every child, so a zone stays meaningful when a new device is
   * paired later rather than silently not applying to them.
   */
  childIds: string[]
  name: string
  /** Real coordinates — the child device evaluates against these on-device. */
  lat: number
  lng: number
  radiusM: number
  notifyArrive: boolean
  notifyLeave: boolean
}

export type Scenario = {
  id: string
  name: string
  /** 0 = Monday … 6 = Sunday. */
  days: number[]
  /**
   * Minutes from midnight, local time. Stored as numbers rather than display
   * strings so editing, comparison and the wire format all agree — a routine
   * whose end is before its start simply runs past midnight.
   */
  fromMin: number
  toMin: number
  enabled: boolean
  blocks: { games: boolean; social: boolean; messaging: boolean }
}

export type AlertKind = 'location' | 'content' | 'sound' | 'contact'

export type Alert = {
  id: string
  kind: AlertKind
  title: string
  who: string
  /**
   * When it happened. The only record of it, and formatted at render.
   *
   * There used to be a `time` string alongside this, built once at ingest — so
   * an alert from yesterday still read "16:42" today, with nothing to say which
   * day it meant. A timestamp formatted when it is drawn cannot go stale.
   */
  ts: number
  /** Which child this came from — required once more than one is paired. */
  childId: string
  tone: Tone
  /** Renders on a tinted card and opens the acoustic detail screen. */
  urgent?: boolean
}

/** One row of the activity trail, and the unit the report exports. */
export type ActivityEntry = {
  seq: number
  ts: number
  kind: string
  ref?: string
  childId: string
}

export type Message = {
  id: string
  from: 'parent' | 'child'
  text: string
}

export type AppUsage = { app: string; minutes: number; tone: Tone }

/**
 * Filters are defined by the wire protocol, not here — the child device is what
 * enforces them, so its definition is the authoritative one. Re-exported so the
 * UI does not have to reach across layers for it.
 */
export type { Filters } from '../link/protocol'
