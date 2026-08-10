import { hasCloud, supabase } from './client'
import type { ChildEvent, Policy, Telemetry } from '../link/protocol'

/**
 * The cloud half of the link.
 *
 * Mirrors `agent/parentLink.ts` on purpose: same verbs, same payloads. The
 * cloud does not replace Bluetooth, it runs *alongside* it — the child device
 * keeps enforcing routines and logging with no signal at all, and this simply
 * removes the wait before a parent can see it.
 *
 * Every function no-ops when the cloud is unconfigured or signed out, so the
 * Bluetooth-only product keeps working untouched. That is the invariant to
 * preserve: adding an account must never be able to break the offline path.
 */

export type CloudSession = { userId: string; email: string | null } | null

/* -------------------------------------------------------------------- auth */

export async function currentSession(): Promise<CloudSession> {
  if (!hasCloud()) return null
  const { data } = await supabase().auth.getSession()
  const u = data.session?.user
  return u ? { userId: u.id, email: u.email ?? null } : null
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password })
  if (error) throw new Error(friendly(error.message))
  return data.user?.id ?? null
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase().auth.signUp({ email, password })
  if (error) throw new Error(friendly(error.message))
  return data.user?.id ?? null
}

export async function signOut() {
  if (hasCloud()) await supabase().auth.signOut()
}

/** Auth errors are written for developers; parents get something actionable. */
function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login')) return 'That email and password do not match.'
  if (m.includes('already registered')) return 'That email already has an account. Try signing in.'
  if (m.includes('password')) return 'Passwords need at least six characters.'
  if (m.includes('network') || m.includes('fetch')) return 'No connection. Your phones still work over Bluetooth.'
  return message
}

/* --------------------------------------------------------------- household */

/**
 * The household this user belongs to, creating one on first sign-in.
 *
 * Membership is written by a database trigger rather than a second insert
 * here — see the `household_add_creator` migration. Doing it client-side left
 * a window where a dropped connection produced a household nobody could read,
 * including its own creator.
 */
export async function ensureHousehold(): Promise<string | null> {
  if (!hasCloud()) return null
  const db = supabase()

  const { data: existing, error } = await db
    .from('household_members')
    .select('household_id')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (existing?.household_id) return existing.household_id as string

  const { data: created, error: createErr } = await db
    .from('households')
    .insert({ name: 'My family' })
    .select('id')
    .single()
  if (createErr) throw createErr
  return created.id as string
}

/* ------------------------------------------------------------------ push */

/** Registers a paired child, or returns the existing row for this device. */
export async function upsertChild(
  householdId: string,
  child: { peerId: string; name: string; avatar: string; deviceId?: string },
): Promise<string | null> {
  if (!hasCloud()) return null
  const db = supabase()

  const { data: found } = await db
    .from('children')
    .select('id')
    .eq('household_id', householdId)
    .eq('ble_address', child.peerId)
    .maybeSingle()

  if (found?.id) {
    await db
      .from('children')
      .update({ name: child.name, avatar: child.avatar, device_id: child.deviceId ?? null })
      .eq('id', found.id)
    return found.id as string
  }

  const { data, error } = await db
    .from('children')
    .insert({
      household_id: householdId,
      name: child.name,
      avatar: child.avatar,
      ble_address: child.peerId,
      device_id: child.deviceId ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function pushPolicy(householdId: string, childId: string | null, policy: Policy) {
  if (!hasCloud()) return
  // Upsert on the composite key: re-pushing the same version is normal (the
  // app re-sends on every reconnect) and must not error.
  await supabase()
    .from('policies')
    .upsert(
      {
        household_id: householdId,
        child_id: childId,
        version: policy.version,
        body: policy as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'household_id,child_id,version' },
    )
}

/**
 * Uploads child events.
 *
 * `ignoreDuplicates` matters: the device resends until acked, and seq is unique
 * per child, so replays are the normal case rather than an error to surface.
 */
export async function pushEvents(childId: string, events: ChildEvent[]) {
  if (!hasCloud() || events.length === 0) return
  await supabase()
    .from('child_events')
    .upsert(
      events.map((e) => ({
        child_id: childId,
        seq: e.seq,
        ts: new Date(e.ts).toISOString(),
        kind: e.kind,
        ref: e.ref ?? null,
        cat: e.cat ?? null,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
      })),
      { onConflict: 'child_id,seq', ignoreDuplicates: true },
    )
}

export async function pushTelemetry(childId: string, t: Telemetry) {
  if (!hasCloud()) return
  await supabase()
    .from('child_telemetry')
    .upsert({
      child_id: childId,
      ts: new Date(t.ts).toISOString(),
      battery: t.battery,
      charging: t.charging,
      lat: t.fix?.lat ?? null,
      lng: t.fix?.lng ?? null,
      accuracy_m: t.fix?.acc ?? null,
      active_scenario_id: t.activeScenarioId,
      locked: t.locked,
      updated_at: new Date().toISOString(),
    })
}
