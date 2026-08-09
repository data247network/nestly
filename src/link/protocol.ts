/**
 * The Nestly device-to-device protocol.
 *
 * Parent and child phones talk over BLE: the child runs as a *peripheral*
 * (advertises + GATT server), the parent as a *central*. That split is forced
 * by Android — only one side can advertise a connectable service — and it maps
 * naturally onto the product, since the child device is the one that must keep
 * working when nobody is holding it.
 *
 * BLE is a short-range link, so this is deliberately a **store-and-forward**
 * protocol, not a live feed. The child records telemetry and events into a
 * local log whether or not anyone is listening, and hands over the backlog when
 * the parent next comes into range. `Ack.upTo` is what lets the child drop the
 * part of the log the parent has durably stored.
 */

/** Bumped when a change would break an older peer. Checked in `Hello`. */
export const PROTOCOL_VERSION = 1

/**
 * Service and characteristic UUIDs. Fixed constants — the parent scans for
 * SERVICE_UUID specifically, which is what stops it enumerating every BLE
 * gadget in the house.
 */
export const SERVICE_UUID = 'f1a70001-9c2b-4a55-8e7d-3b6c1d0e5a90'
/** Child -> parent. Notify. Telemetry, events, hello. */
export const CHAR_UPLINK = 'f1a70002-9c2b-4a55-8e7d-3b6c1d0e5a90'
/** Parent -> child. Write. Policy and acks. */
export const CHAR_DOWNLINK = 'f1a70003-9c2b-4a55-8e7d-3b6c1d0e5a90'

/* ------------------------------------------------------------------ types -- */

export type ChildEventKind =
  | 'zone-enter'
  | 'zone-leave'
  | 'scenario-start'
  | 'scenario-end'
  | 'lock-shown'
  | 'lock-dismissed'
  | 'battery-low'
  | 'agent-start'
  /** A lookup was refused. `ref` is the domain, `cat` the category that matched. */
  | 'site-blocked'
  /** Allowed, but the child was shown a warning first. */
  | 'site-warned'
  /** Filtering stopped — the child turned the VPN off, or it was never granted. */
  | 'filter-off'
  /** A reminder fired on the child's phone. `ref` is the reminder title. */
  | 'reminder-shown'
  /**
   * A new contact appeared in the child's phone. `ref` is the display name.
   * The number is never sent — the parent needs to know *that* someone new
   * appeared, not to receive a copy of their child's address book.
   */
  | 'contact-added'

export type ChildEvent = {
  /** Monotonic per-child sequence number. Drives ack/replay. */
  seq: number
  ts: number
  kind: ChildEventKind
  /** Zone name, scenario id, blocked domain — whatever the kind needs. */
  ref?: string
  /** Which filter category matched, for site-blocked / site-warned. */
  cat?: BlockCategory
  lat?: number
  lng?: number
}

export type BlockCategory = 'adult' | 'violence' | 'gambling' | 'social'

export const BLOCK_CATEGORIES: BlockCategory[] = ['adult', 'violence', 'gambling', 'social']

export type Filters = {
  adult: boolean
  violence: boolean
  gambling: boolean
  /** Optional so a policy from an older build still parses. */
  social?: boolean
  /** Domains the parent added by hand. */
  custom: string[]
  /**
   * Categories that warn the child instead of blocking outright. Age-appropriate
   * guidance for an older child, where a hard block would just push them to a
   * browser you cannot see.
   */
  warn?: BlockCategory[]
}

/** One app's foreground time, as reported by the child device. */
export type AppUsageEntry = {
  /** Android package name — the stable identity. */
  pkg: string
  label: string
  minutes: number
  category: 'social' | 'games' | 'video' | 'education' | 'other'
}

/** A domain the child's device looked up, with how often. */
export type SiteVisit = {
  domain: string
  count: number
  lastAt: number
  blocked: boolean
  cat?: BlockCategory
}

/** Periodic activity report — usage and browsing, for the day so far. */
export type UsageReport = {
  t: 'usage'
  /** Local day this covers, as YYYY-MM-DD. */
  day: string
  apps: AppUsageEntry[]
  sites: SiteVisit[]
  /** False when the child has revoked usage access or the VPN. */
  usageAccess: boolean
  filterOn: boolean
}

export type Fix = { lat: number; lng: number; acc: number; ts: number }

export type Hello = {
  t: 'hello'
  protocol: number
  deviceId: string
  name: string
  /** Highest event seq the child has produced, so the parent knows the gap. */
  headSeq: number
  /** Policy version the child is currently running. */
  policyVersion: number
}

export type Telemetry = {
  t: 'telemetry'
  ts: number
  battery: number | null
  charging: boolean | null
  fix: Fix | null
  activeScenarioId: string | null
  locked: boolean
}

export type Events = { t: 'events'; events: ChildEvent[] }

/**
 * A note between the two phones.
 *
 * Deliberately not called a chat. Over Bluetooth alone a message can only cross
 * when the phones are near each other, so this is a note left for someone —
 * queued on the sender, handed over on contact, and acknowledged so the UI can
 * say truthfully whether it actually arrived.
 */
export type Note = {
  id: string
  from: 'parent' | 'child'
  text: string
  /** When the sender wrote it, not when it was delivered. */
  ts: number
}

export type Notes = { t: 'notes'; notes: Note[] }

/** Receipt for notes that are now durably stored on the other side. */
export type NoteAck = { t: 'note-ack'; ids: string[] }

export type PolicyScenario = {
  id: string
  name: string
  /** 0 = Monday … 6 = Sunday. */
  days: number[]
  /** Minutes from midnight, local time. */
  fromMin: number
  toMin: number
  enabled: boolean
  blocks: { games: boolean; social: boolean; messaging: boolean }
}

export type PolicyGeofence = {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
  notifyArrive: boolean
  notifyLeave: boolean
}

/**
 * A number the child may always call, including while the phone is locked.
 *
 * These are part of the policy rather than something the child configures: the
 * parent decides who counts as reachable, and the list has to survive with no
 * network — a lock screen that cannot dial for help is a safety defect.
 */
export type EmergencyContact = {
  id: string
  name: string
  phone: string
}

export const MAX_EMERGENCY_CONTACTS = 4

/**
 * A reminder the parent sets and the child's phone shows.
 *
 * Carried in the policy rather than sent as a message, so it fires on schedule
 * whether or not the phones are in range — "take your inhaler at 8am" must not
 * depend on Bluetooth. The child device evaluates it locally, exactly as it
 * does scenarios.
 */
export type Reminder = {
  id: string
  title: string
  /** Optional longer note shown under the title on the child's phone. */
  note?: string
  /** Minutes from midnight, local time. */
  atMin: number
  /** 0 = Monday … 6 = Sunday. Empty means every day. */
  days: number[]
  enabled: boolean
}

export const MAX_REMINDERS = 12

/** Whether a reminder is due within `windowMin` after its time, on `when`. */
export function reminderDueAt(r: Reminder, when: Date, windowMin = 2): boolean {
  if (!r.enabled) return false
  const today = (when.getDay() + 6) % 7
  if (r.days.length > 0 && !r.days.includes(today)) return false
  const min = when.getHours() * 60 + when.getMinutes()
  return min >= r.atMin && min < r.atMin + windowMin
}

export type Policy = {
  t: 'policy'
  version: number
  scenarios: PolicyScenario[]
  geofences: PolicyGeofence[]
  filters: Filters
  /** One-shot: lock the device now until the parent clears it. */
  lockNow: boolean
  /**
   * Optional so a policy written by an older build still parses — the child
   * falls back to an empty list rather than rejecting the whole message.
   */
  contacts?: EmergencyContact[]
  /** Optional so a policy from an older build still parses. */
  reminders?: Reminder[]
}

/** Parent confirms it has durably stored events up to and including `upTo`. */
export type Ack = { t: 'ack'; upTo: number; policyVersion: number }

export type Uplink = Hello | Telemetry | Events | UsageReport
export type Downlink = Policy | Ack
/** Notes travel both ways, so they sit outside the uplink/downlink split. */
export type Message = Uplink | Downlink | Notes | NoteAck

/* --------------------------------------------------------------- framing -- */

/**
 * BLE payloads are tiny — 20 bytes before MTU negotiation, and not reliably
 * more than ~180 after — so every message is chunked and reassembled.
 *
 * Header is 4 bytes: [msgId, chunkIndex, chunkCount, flags]. A single message
 * is therefore capped at 255 chunks, which at the default chunk size is ~45 KB:
 * far more than any frame here needs, and small enough that a corrupt header
 * can't make us allocate wildly.
 */
export const FRAME_HEADER = 4
export const DEFAULT_CHUNK = 180

export function encodeMessage(
  msg: Message,
  msgId: number,
  chunkSize = DEFAULT_CHUNK,
): Uint8Array[] {
  const body = new TextEncoder().encode(JSON.stringify(msg))
  const payload = Math.max(1, chunkSize - FRAME_HEADER)
  const count = Math.max(1, Math.ceil(body.length / payload))
  if (count > 255) throw new Error(`message too large to frame: ${body.length} bytes`)

  const out: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const slice = body.subarray(i * payload, (i + 1) * payload)
    const frame = new Uint8Array(FRAME_HEADER + slice.length)
    frame[0] = msgId & 0xff
    frame[1] = i
    frame[2] = count
    frame[3] = 0
    frame.set(slice, FRAME_HEADER)
    out.push(frame)
  }
  return out
}

/**
 * Reassembles chunks back into messages.
 *
 * Deliberately tolerant: BLE notifications can be dropped or reordered, so a
 * partial message that never completes is abandoned rather than wedging the
 * stream. `sweep()` drops anything stale.
 */
type Partial = {
  chunks: (Uint8Array | undefined)[]
  count: number
  /** Counted explicitly rather than scanning: a sparse array's `some`/`every` skip holes. */
  received: number
  at: number
}

export class Reassembler {
  private partial = new Map<number, Partial>()

  constructor(private staleMs = 30_000) {}

  push(frame: Uint8Array): Message[] {
    if (frame.length < FRAME_HEADER) return []
    const [msgId, index, count] = [frame[0], frame[1], frame[2]]
    if (count === 0 || index >= count) return []

    let entry = this.partial.get(msgId)
    // A repeated msgId with a different chunk count means the sender rolled
    // over onto a new message; start again rather than mixing the two.
    if (!entry || entry.count !== count) {
      entry = {
        chunks: new Array<Uint8Array | undefined>(count).fill(undefined),
        count,
        received: 0,
        at: Date.now(),
      }
      this.partial.set(msgId, entry)
    }
    // A duplicate chunk must not count twice, or the message completes early
    // with a hole in it.
    if (entry.chunks[index] === undefined) entry.received += 1
    entry.chunks[index] = frame.subarray(FRAME_HEADER)
    entry.at = Date.now()

    if (entry.received < entry.count) return []
    this.partial.delete(msgId)

    const total = entry.chunks.reduce((n, c) => n + (c ? c.length : 0), 0)
    const body = new Uint8Array(total)
    let at = 0
    for (const c of entry.chunks) {
      if (c) {
        body.set(c, at)
        at += c.length
      }
    }

    try {
      const msg = JSON.parse(new TextDecoder().decode(body)) as Message
      return msg && typeof msg === 'object' && 't' in msg ? [msg] : []
    } catch {
      // A malformed frame is a dropped message, not a crash.
      return []
    }
  }

  sweep(now = Date.now()) {
    for (const [id, e] of this.partial) {
      if (now - e.at > this.staleMs) this.partial.delete(id)
    }
  }

  reset() {
    this.partial.clear()
  }
}

/* ------------------------------------------------------------ base64 glue -- */
// The Capacitor BLE bridges move bytes as base64 strings, and the Android
// plugin does the same, so both transports need this pair.

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/* ------------------------------------------------------------- geo + time -- */

/** Metres between two coordinates. Haversine — fine at geofence distances. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const la1 = toRad(a.lat)
  const la2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Whether a scenario is active at a given moment, in local time.
 *
 * Handles windows that cross midnight (a Bedtime scenario running 21:00–07:00):
 * the day is matched against the day the window *started*, not the day the
 * clock happens to read at 2am.
 */
export function scenarioActiveAt(s: PolicyScenario, when: Date): boolean {
  if (!s.enabled) return false
  const min = when.getHours() * 60 + when.getMinutes()
  // JS getDay(): 0 = Sunday. Protocol uses 0 = Monday.
  const today = (when.getDay() + 6) % 7
  const yesterday = (today + 6) % 7

  if (s.fromMin <= s.toMin) {
    return s.days.includes(today) && min >= s.fromMin && min < s.toMin
  }
  // Crosses midnight: either late on a listed day, or early the morning after.
  return (
    (s.days.includes(today) && min >= s.fromMin) ||
    (s.days.includes(yesterday) && min < s.toMin)
  )
}

/** "8:00 AM" -> minutes from midnight. Tolerant of "08:00" and "20:00". */
export function parseClock(text: string): number {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*$/i.exec(text)
  if (!m) return 0
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const mer = m[3]?.toLowerCase()
  if (mer === 'pm' && h !== 12) h += 12
  if (mer === 'am' && h === 12) h = 0
  return (h % 24) * 60 + Math.min(59, min)
}

export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const mer = h24 >= 12 ? 'PM' : 'AM'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m).padStart(2, '0')} ${mer}`
}
