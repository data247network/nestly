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

/**
 * Creates an account.
 *
 * Returns whether a *session* was established, not merely whether a user row
 * exists. With email confirmation switched on Supabase returns a user and a
 * null session — so checking `data.user` says "signed in" when nothing is
 * authenticated, and the very next call fails against RLS with auth.uid() null.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ userId: string | null; signedIn: boolean }> {
  const { data, error } = await supabase().auth.signUp({ email, password })
  if (error) throw new Error(friendly(error.message))
  return { userId: data.user?.id ?? null, signedIn: data.session != null }
}

export async function signOut() {
  if (hasCloud()) await supabase().auth.signOut()
}

/** Auth errors are written for developers; parents get something actionable. */
function friendly(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login')) return 'That email and password do not match.'
  // Distinct from a wrong password, and the fix is completely different.
  if (m.includes('not confirmed') || m.includes('confirm your email')) {
    return 'Confirm your email first — check your inbox, then sign in.'
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.'
  }
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

  // Insert and read are two statements on purpose.
  //
  // `.insert().select()` evaluates RETURNING under the SELECT policy inside the
  // same statement, and that policy calls `is_household_member`, which is
  // STABLE — so it sees the snapshot from the *start* of the statement. The
  // membership row is written by an AFTER INSERT trigger, which is not in that
  // snapshot. The household is created successfully and then hidden from its
  // own RETURNING clause, so `.single()` fails and the caller concludes nothing
  // was created.
  const { error: createErr } = await db.from('households').insert({ name: 'My family' })
  if (createErr) throw createErr

  // Fresh statement, fresh snapshot: the trigger's membership row is visible.
  const { data: mine, error: findErr } = await db
    .from('household_members')
    .select('household_id')
    .limit(1)
    .maybeSingle()
  if (findErr) throw findErr
  if (!mine?.household_id) {
    throw new Error('Your family was created but could not be opened. Try again.')
  }
  return mine.household_id as string
}

/* ---------------------------------------------------------- enrolment -- */

export type Enrolment = {
  childId: string
  householdId: string
  name: string
  avatar: string
  deviceSecret: string
}

/** Where an enrolled child device remembers what it was linked to. */
export const ENROLMENT_KEY = 'nestly.enrolment'

/**
 * Redeems an invite code on the child's phone.
 *
 * Called with no session, which is the whole point — a child never signs in to
 * be supervised. It goes to the edge function rather than the REST API because
 * the code *is* the credential and only the service role may act on it.
 *
 * Uses plain fetch rather than the Supabase client: the client would attach an
 * Authorization header for a session that does not exist, and there is nothing
 * here for it to do.
 */
export async function redeemInvite(
  code: string,
  deviceId: string,
  deviceName?: string,
): Promise<Enrolment> {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('This build has no online service configured.')

  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/enroll-child`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ code, deviceId, deviceName }),
    })
  } catch {
    // A rejected fetch is deliberately opaque in a browser: a dead network, a
    // failed DNS lookup and a refused CORS preflight all arrive as the same
    // TypeError. Blaming the phone's connection was therefore a guess, and a
    // wrong one — a broken preflight on the function sent us looking at the
    // child's wifi for hours. Say what is actually known.
    throw new Error('Could not reach the setup service. Check the phone is online, then try again.')
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string } & Partial<Enrolment>
  if (!res.ok) throw new Error(body.error ?? 'That code could not be used.')
  if (!body.childId || !body.deviceSecret) throw new Error('Setup did not complete. Try again.')

  return body as Enrolment
}

/* ------------------------------------------------------ household reads */

export type CloudChild = {
  id: string
  name: string
  avatar: string
  enrolledAt: string | null
  deviceId: string | null
}

export type HouseholdSummary = {
  id: string
  name: string
  plan: string
  memberCount: number
  children: CloudChild[]
}

export async function loadHousehold(householdId: string): Promise<HouseholdSummary | null> {
  if (!hasCloud()) return null
  const db = supabase()

  const [{ data: house }, { data: kids }, { count }] = await Promise.all([
    db.from('households').select('id, name, plan').eq('id', householdId).maybeSingle(),
    db
      .from('children')
      .select('id, name, avatar, enrolled_at, device_id')
      .eq('household_id', householdId)
      .order('name'),
    db
      .from('household_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('household_id', householdId),
  ])

  if (!house) return null
  return {
    id: house.id as string,
    name: house.name as string,
    plan: (house.plan as string) ?? 'free',
    memberCount: count ?? 1,
    children: (kids ?? []).map((k) => ({
      id: k.id as string,
      name: k.name as string,
      avatar: (k.avatar as string) ?? '#147D77',
      enrolledAt: (k.enrolled_at as string) ?? null,
      deviceId: (k.device_id as string) ?? null,
    })),
  }
}

export async function renameHousehold(householdId: string, name: string) {
  if (!hasCloud()) return
  await supabase().from('households').update({ name: name.trim() || 'My family' }).eq('id', householdId)
}

/** Creates the child record first; the device attaches to it later by code. */
export async function createChild(householdId: string, name: string, avatar: string) {
  const { data, error } = await supabase()
    .from('children')
    .insert({ household_id: householdId, name: name.trim() || 'My child', avatar })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function removeChild(childId: string) {
  if (!hasCloud()) return
  await supabase().from('children').delete().eq('id', childId)
}

/**
 * Mints an invite code.
 *
 * Generated client-side rather than by the database function, which is revoked
 * from the REST surface — a code generator callable over HTTP would let anyone
 * burn through the keyspace. The alphabet matches the server's: no I, O, 0 or 1,
 * because a parent reads this down the phone to a child.
 *
 * The primary key does the real work: a collision is a failed insert, so it is
 * retried rather than silently overwriting someone else's invite.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export async function createInvite(householdId: string, childId: string): Promise<string> {
  const db = supabase()
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')

    const { error } = await db
      .from('child_invites')
      .insert({ code, child_id: childId, household_id: householdId })
    if (!error) return code
    // 23505 is a unique violation — try another code. Anything else is real.
    if (error.code !== '23505') throw error
  }
  throw new Error('Could not create a code. Try again.')
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
