import { Preferences } from '@capacitor/preferences'
import { Capacitor } from '@capacitor/core'

/**
 * Durable key/value storage.
 *
 * Capacitor Preferences natively, localStorage in the browser. Both are
 * async-shaped so calling code doesn't branch, and every read is defensive:
 * a device that fails to load its own state should come up empty and re-pair,
 * not white-screen.
 */

const memoryFallback = new Map<string, string>()

/**
 * Development-only key namespace.
 *
 * The loopback link needs both roles on the same origin so they share a
 * BroadcastChannel — but same origin also means one localStorage, so two tabs
 * would overwrite each other's device role and pairing. `?device=parent` /
 * `?device=child` partitions the keys so the two tabs behave like two phones.
 *
 * Never applies on a real device, where there is exactly one role per install.
 */
const NS = (() => {
  if (Capacitor.isNativePlatform()) return ''
  try {
    const d = new URLSearchParams(globalThis.location?.search ?? '').get('device')
    return d === 'parent' || d === 'child' ? `${d}.` : ''
  } catch {
    return ''
  }
})()

const key_ = (key: string) => NS + key

async function rawGet(rawKey: string): Promise<string | null> {
  const key = key_(rawKey)
  try {
    if (Capacitor.isNativePlatform()) {
      return (await Preferences.get({ key })).value
    }
    return globalThis.localStorage?.getItem(key) ?? memoryFallback.get(key) ?? null
  } catch {
    return memoryFallback.get(key) ?? null
  }
}

async function rawSet(rawKey: string, value: string): Promise<void> {
  const key = key_(rawKey)
  memoryFallback.set(key, value)
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key, value })
    } else {
      globalThis.localStorage?.setItem(key, value)
    }
  } catch {
    // Storage full or unavailable — the in-memory copy keeps this session
    // working; it just won't survive a restart.
  }
}

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await rawGet(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  await rawSet(key, JSON.stringify(value))
}

export async function remove(rawKey: string): Promise<void> {
  const key = key_(rawKey)
  memoryFallback.delete(key)
  try {
    if (Capacitor.isNativePlatform()) await Preferences.remove({ key })
    else globalThis.localStorage?.removeItem(key)
  } catch {
    /* nothing useful to do */
  }
}

/**
 * Clears the in-process fallback. Only for tests — a device has exactly one
 * store for its lifetime, so nothing in the app should ever call this.
 */
export function __resetMemoryForTests() {
  memoryFallback.clear()
}

export const KEYS = {
  role: 'nestly.role',
  deviceId: 'nestly.deviceId',
  parentState: 'nestly.parent.state',
  childState: 'nestly.child.state',
  childLog: 'nestly.child.log',
  /** Legacy single pairing. Read once at startup and migrated into `pairings`. */
  pairing: 'nestly.pairing',
  pairings: 'nestly.pairings',
  onboarded: 'nestly.onboarded',
  signedIn: 'nestly.signedIn',
  notes: 'nestly.notes',
  /**
   * What an enrolled child device was linked to. Declared here, alongside every
   * other key, rather than in `cloud/sync` — the child agent needs to read it,
   * and importing it from there would pull the Supabase client into the offline
   * path for the sake of one string.
   */
  enrolment: 'nestly.enrolment',
  /**
   * When this device last opened the notes tab.
   *
   * The unread badge counted every note from the other side for all time, so it
   * never cleared and stopped meaning anything. Stored rather than held in
   * memory because a badge you have already dealt with reappearing after a
   * relaunch is exactly as annoying as one that never clears.
   */
  notesReadAt: 'nestly.notes.readAt',
  /**
   * Where the native uploader posts.
   *
   * The endpoint is compiled into the JavaScript bundle from VITE_SUPABASE_URL,
   * and the foreground service has no way to read an import.meta value. Writing
   * it here is how the two halves agree on one address without hardcoding it in
   * Java, where a change of project would mean editing two languages.
   */
  cloudEndpoint: 'nestly.cloud.endpoint',
} as const

/** Per-child key suffixes, so each paired device keeps its own cursor. */
export const perChild = {
  ackedSeq: (peerId: string) => `nestly.parent.ackedSeq.${peerId}`,
  notes: (peerId: string) => `nestly.notes.${peerId}`,
} as const

/** Stable per-install id, minted once. */
export async function deviceId(): Promise<string> {
  const existing = await rawGet(KEYS.deviceId)
  if (existing) return existing
  const id = `nd-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
  await rawSet(KEYS.deviceId, id)
  return id
}
