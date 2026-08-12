import { hasCloud, supabase } from './client'
import { KEYS } from '../platform/storage'
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

export type CloudSession = {
  userId: string
  email: string | null
  /** What to call this person. Null until they tell us. */
  name: string | null
} | null

/**
 * A usable first name, without inventing one.
 *
 * Falls back to the local part of the email, which is right far more often
 * than it is wrong — most people's address starts with their name — but never
 * to something guessed from nothing. An empty greeting beats greeting someone
 * by the wrong name.
 */
export function greetingName(session: { name?: string | null; email?: string | null }): string | null {
  const explicit = session.name?.trim()
  if (explicit) return explicit.split(/\s+/)[0]

  const local = session.email?.split('@')[0] ?? ''
  // Strip the separators and digits people put in addresses, then take the
  // first word: "eton.joseph" -> "Eton", "sarah_w99" -> "Sarah".
  const first = local.split(/[._\-+0-9]+/).filter(Boolean)[0]
  if (!first || first.length < 2) return null
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
}

/* -------------------------------------------------------------------- auth */

export async function currentSession(): Promise<CloudSession> {
  if (!hasCloud()) return null
  const { data } = await supabase().auth.getSession()
  const u = data.session?.user
  if (!u) return null
  const meta = (u.user_metadata ?? {}) as { full_name?: string; name?: string }
  return {
    userId: u.id,
    email: u.email ?? null,
    name: meta.full_name ?? meta.name ?? null,
  }
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

/**
 * Where an enrolled child device remembers what it was linked to.
 *
 * Re-exported from the storage key registry so the child agent can read it
 * without importing this module, and so there is still only one definition.
 */
export const ENROLMENT_KEY = KEYS.enrolment

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

/**
 * The numbers on the dashboard's overview row.
 *
 * Every one is derived from a real table. A dashboard that invents plausible
 * figures is worse than one that admits it has none: a parent who sees
 * "2 alerts today" has to be able to click through and find two alerts, and a
 * fresh household must be allowed to read zero.
 *
 * `null` means "not known yet" and renders as an em dash — distinct from zero,
 * which is a measurement.
 */
export type DashboardStats = {
  locationsToday: number
  alertsToday: number
  screenTimeMinutes: number | null
  lastSyncAt: string | null
  devicesLinked: number
}

/** Event kinds a parent would call an alert, as opposed to routine telemetry. */
const ALERT_KINDS = [
  'zone-enter',
  'zone-leave',
  'battery-low',
  'site-blocked',
  'filter-off',
  'contact-added',
]

export async function loadStats(householdId: string): Promise<DashboardStats> {
  const db = supabase()
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const since = startOfDay.toISOString()
  const today = new Date().toISOString().slice(0, 10)

  const { data: kids } = await db.from('children').select('id, enrolled_at').eq('household_id', householdId)
  const ids = (kids ?? []).map((k) => k.id as string)
  const devicesLinked = (kids ?? []).filter((k) => k.enrolled_at).length

  // No children yet: every count is a true zero, and querying `in ()` would
  // error rather than return nothing.
  if (ids.length === 0) {
    return { locationsToday: 0, alertsToday: 0, screenTimeMinutes: null, lastSyncAt: null, devicesLinked: 0 }
  }

  const [locations, alerts, usage, sync] = await Promise.all([
    db
      .from('child_events')
      .select('seq', { count: 'exact', head: true })
      .in('child_id', ids)
      .gte('ts', since)
      .not('lat', 'is', null),
    db
      .from('child_events')
      .select('seq', { count: 'exact', head: true })
      .in('child_id', ids)
      .gte('ts', since)
      .in('kind', ALERT_KINDS),
    db.from('child_usage').select('apps').in('child_id', ids).eq('day', today),
    db
      .from('child_telemetry')
      .select('updated_at')
      .in('child_id', ids)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Absent rows mean the devices have not reported today, which is not the same
  // as reporting zero minutes.
  const rows = usage.data ?? []
  const screenTimeMinutes = rows.length
    ? rows.reduce((total, row) => {
        const apps = (row.apps ?? []) as { minutes?: number }[]
        return total + apps.reduce((sum, a) => sum + (Number(a.minutes) || 0), 0)
      }, 0)
    : null

  return {
    locationsToday: locations.count ?? 0,
    alertsToday: alerts.count ?? 0,
    screenTimeMinutes,
    lastSyncAt: (sync.data?.updated_at as string) ?? null,
    devicesLinked,
  }
}

export type DeviceRow = {
  childId: string
  name: string
  avatar: string
  enrolled: boolean
  battery: number | null
  charging: boolean | null
  locked: boolean | null
  lastSeenAt: string | null
}

/** Per-child device state, for the Devices section. */
export async function loadDevices(householdId: string): Promise<DeviceRow[]> {
  const db = supabase()
  const { data: kids } = await db
    .from('children')
    .select('id, name, avatar, enrolled_at')
    .eq('household_id', householdId)
    .order('name')

  const ids = (kids ?? []).map((k) => k.id as string)
  if (ids.length === 0) return []

  const { data: tele } = await db
    .from('child_telemetry')
    .select('child_id, battery, charging, locked, updated_at')
    .in('child_id', ids)

  const byChild = new Map((tele ?? []).map((t) => [t.child_id as string, t]))
  return (kids ?? []).map((k) => {
    const t = byChild.get(k.id as string)
    return {
      childId: k.id as string,
      name: k.name as string,
      avatar: (k.avatar as string) ?? '#147D77',
      enrolled: Boolean(k.enrolled_at),
      battery: (t?.battery as number) ?? null,
      charging: (t?.charging as boolean) ?? null,
      locked: (t?.locked as boolean) ?? null,
      lastSeenAt: (t?.updated_at as string) ?? null,
    }
  })
}

export type AlertRow = {
  id: string
  childName: string
  kind: string
  ref: string | null
  ts: string
}

/** The most recent notable events across the household. */
export async function loadAlerts(householdId: string, limit = 40): Promise<AlertRow[]> {
  const db = supabase()
  const { data: kids } = await db.from('children').select('id, name').eq('household_id', householdId)
  const ids = (kids ?? []).map((k) => k.id as string)
  if (ids.length === 0) return []
  const names = new Map((kids ?? []).map((k) => [k.id as string, k.name as string]))

  const { data } = await db
    .from('child_events')
    .select('id, child_id, kind, ref, ts')
    .in('child_id', ids)
    .in('kind', ALERT_KINDS)
    .order('ts', { ascending: false })
    .limit(limit)

  return (data ?? []).map((e) => ({
    id: String(e.id),
    childName: names.get(e.child_id as string) ?? 'Child',
    kind: e.kind as string,
    ref: (e.ref as string) ?? null,
    ts: e.ts as string,
  }))
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

/* ------------------------------------------------------------ plans -- */

export type PlanRow = {
  id: string
  name: string
  maxParents: number
  maxChildren: number
  priceMonthly: number
  priceAnnual: number
  currency: string
  blurb: string
  active: boolean
}

/**
 * The plan catalogue, from the database.
 *
 * Prices and limits used to be compiled into the app, so changing either meant
 * a release on every phone. Reading them means an admin can retire a tier or
 * move a price without a deploy — and the upgrade screen shows what is actually
 * being charged rather than what was true at build time.
 */
export async function loadPlans(): Promise<PlanRow[]> {
  if (!hasCloud()) return []
  const { data, error } = await supabase()
    .from('plans')
    .select('id, name, max_parents, max_children, price_monthly, price_annual, currency, blurb, active')
    .order('sort')
  if (error) throw error
  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    maxParents: Number(p.max_parents),
    maxChildren: Number(p.max_children),
    priceMonthly: Number(p.price_monthly),
    priceAnnual: Number(p.price_annual),
    currency: (p.currency as string) ?? 'GBP',
    blurb: (p.blurb as string) ?? '',
    active: Boolean(p.active),
  }))
}

export function formatPrice(amount: number, currency: string): string {
  if (amount === 0) return 'Free'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/* ---------------------------------------------------------- adults -- */

export type Adult = { userId: string; role: string; joinedAt: string; isSelf: boolean }

/**
 * The adults on this account.
 *
 * Emails are not included: they live in auth.users, which no ordinary client
 * may read, and exposing every co-parent's address to anyone who joined the
 * household is not worth a nicer list. Role and join date identify a row well
 * enough for the one action available — removing it.
 */
export async function loadAdults(householdId: string): Promise<Adult[]> {
  if (!hasCloud()) return []
  const db = supabase()
  const [{ data }, { data: session }] = await Promise.all([
    db.from('household_members').select('user_id, role, joined_at').eq('household_id', householdId),
    db.auth.getUser(),
  ])
  const me = session?.user?.id
  return (data ?? []).map((m) => ({
    userId: m.user_id as string,
    role: (m.role as string) ?? 'member',
    joinedAt: m.joined_at as string,
    isSelf: m.user_id === me,
  }))
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Mints a code a second adult can redeem to join this household. */
export async function createAdultInvite(householdId: string): Promise<string> {
  const db = supabase()
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const code = Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('')
    const { error } = await db
      .from('household_invites')
      .insert({ code, household_id: householdId })
    if (!error) return code
    if (error.code !== '23505') throw error
  }
  throw new Error('Could not create an invitation. Try again.')
}

/**
 * Joins the household an invitation points at.
 *
 * Goes through a SECURITY DEFINER function because joining means writing to a
 * household the caller is not yet in, which every policy correctly refuses.
 * The capacity check lives there too — the only place it cannot be skipped.
 */
export async function redeemAdultInvite(code: string): Promise<string> {
  const { data, error } = await supabase().rpc('redeem_household_invite', { p_code: code })
  if (error) throw new Error(error.message)
  return data as string
}

export async function removeAdult(householdId: string, userId: string) {
  const { error } = await supabase()
    .from('household_members')
    .delete()
    .eq('household_id', householdId)
    .eq('user_id', userId)
  if (error) throw error
}

/* ------------------------------------------------------ plan admin -- */

/** Creates or updates a plan. Refused server-side unless the caller is an owner. */
export async function adminUpsertPlan(p: PlanRow & { sort?: number }) {
  const { error } = await supabase().rpc('admin_upsert_plan', {
    p_id: p.id,
    p_name: p.name,
    p_max_parents: p.maxParents,
    p_max_children: p.maxChildren,
    p_price_monthly: p.priceMonthly,
    p_price_annual: p.priceAnnual,
    p_currency: p.currency,
    p_blurb: p.blurb,
    p_active: p.active,
    p_sort: p.sort ?? 0,
  })
  if (error) throw new Error(error.message)
}

export async function adminDeletePlan(id: string) {
  const { error } = await supabase().rpc('admin_delete_plan', { p_id: id })
  if (error) throw new Error(error.message)
}

/**
 * The cheapest active plan that would raise both limits past what is needed.
 *
 * Used to name a specific upgrade rather than saying "upgrade" and leaving the
 * parent to work out which tier actually solves their problem.
 */
export function nextPlanFor(
  plans: PlanRow[],
  need: { children?: number; adults?: number },
): PlanRow | null {
  const wantChildren = need.children ?? 0
  const wantAdults = need.adults ?? 0
  return (
    plans
      .filter((p) => p.active)
      .filter((p) => p.maxChildren >= wantChildren && p.maxParents >= wantAdults)
      .sort((a, b) => a.priceMonthly - b.priceMonthly)[0] ?? null
  )
}

/** Moves a household onto a plan. Validated against the catalogue, owner-only. */
export async function adminSetHouseholdPlan(householdId: string, plan: string) {
  const { error } = await supabase().rpc('admin_set_household_plan', {
    p_household_id: householdId,
    p_plan: plan,
  })
  if (error) throw new Error(error.message)
}

/* --------------------------------------------------------- payments -- */

export type CurrencyPrice = { currency: string; monthly: number; annual: number }

/** Every currency a plan is priced in, so checkout can offer the right one. */
export async function loadPlanPrices(): Promise<Record<string, CurrencyPrice[]>> {
  if (!hasCloud()) return {}
  const { data } = await supabase()
    .from('plan_prices')
    .select('plan_id, currency, price_monthly, price_annual')
  const out: Record<string, CurrencyPrice[]> = {}
  for (const r of data ?? []) {
    const id = r.plan_id as string
    ;(out[id] ??= []).push({
      currency: r.currency as string,
      monthly: Number(r.price_monthly),
      annual: Number(r.price_annual),
    })
  }
  return out
}

/**
 * Starts a checkout and returns where to send the customer.
 *
 * The amount is deliberately not a parameter. It is looked up server-side from
 * the plan — a client that could name its own price would buy Premium for a
 * penny.
 */
export async function startCheckout(
  provider: 'opay',
  householdId: string,
  planId: string,
  period: 'monthly' | 'annual',
): Promise<string> {
  const { data: session } = await supabase().auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('Sign in first.')

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${provider}-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ householdId, planId, period }),
  })
  const body = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string }
  if (!res.ok || !body.checkoutUrl) {
    throw new Error(body.error ?? 'Could not start checkout.')
  }
  return body.checkoutUrl
}

export async function adminSetPlanPrice(
  planId: string,
  currency: string,
  monthly: number,
  annual: number,
) {
  const { error } = await supabase().rpc('admin_set_plan_price', {
    p_plan_id: planId,
    p_currency: currency,
    p_monthly: monthly,
    p_annual: annual,
  })
  if (error) throw new Error(error.message)
}

/* --------------------------------------------------------- realtime -- */

/**
 * Live updates for a household.
 *
 * Without this the web portal only ever showed what was true when the page
 * loaded — a parent watching a child walk home saw nothing move until they
 * refreshed. Postgres changes are pushed down the socket instead.
 *
 * Scoped to this household's children by filter, so a socket does not carry
 * other families' rows to a browser that has no business receiving them. RLS
 * still applies on top; the filter is about not shipping the data at all.
 */
export function subscribeToChildren(
  childIds: string[],
  onChange: (table: 'child_telemetry' | 'child_events' | 'child_usage') => void,
): () => void {
  if (!hasCloud() || childIds.length === 0) return () => {}

  const db = supabase()
  const inList = `in.(${childIds.join(',')})`
  const channel = db.channel(`household-${childIds[0]}`)

  for (const table of ['child_telemetry', 'child_events', 'child_usage'] as const) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `child_id=${inList}` },
      () => onChange(table),
    )
  }

  channel.subscribe()
  return () => {
    void db.removeChannel(channel)
  }
}

/**
 * Sets what to call this parent.
 *
 * Stored in auth metadata rather than a table of our own: it belongs to the
 * person, not to a household, and someone in two families should not have two
 * names.
 */
export async function setDisplayName(name: string) {
  const { error } = await supabase().auth.updateUser({ data: { full_name: name.trim() } })
  if (error) throw new Error(error.message)
}
