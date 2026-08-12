import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"

/**
 * The admin API: everything the business dashboard reads and does.
 *
 * One endpoint with an `action`, rather than a function per operation, because
 * the authorisation is the hard part and it must be identical everywhere. Split
 * across seven deployments, the seventh is where someone forgets the check.
 *
 * Authorisation, in order, on every single request:
 *
 *   1. The bearer token is exchanged for a user id against the auth server, so
 *      a forged token cannot name its own subject.
 *   2. That id must appear in `admin_users`, re-read from the table per request
 *      rather than trusted from a claim — revoking an admin has to take effect
 *      now, and an issued JWT cannot be recalled.
 *   3. Destructive actions additionally require role `owner`.
 *
 * Only then does the service-role client touch anything. That key bypasses RLS
 * completely and must never reach a browser.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })

/** Actions that change or destroy data. Reserved to owners. */
const DESTRUCTIVE = new Set(["setPlan", "setBan", "deleteUser", "deleteHousehold"])

Deno.serve(async (req: Request) => {
  // 204 is a null-body status; passing a body throws and the runtime answers
  // with a bare 500 carrying no CORS headers, failing the preflight.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Not signed in." }, 401)

  const url = Deno.env.get("SUPABASE_URL")!
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  })

  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: who } = await asCaller.auth.getUser()
  const callerId = who?.user?.id
  if (!callerId) return json({ error: "Not signed in." }, 401)

  const { data: me } = await admin
    .from("admin_users")
    .select("user_id, role")
    .eq("user_id", callerId)
    .maybeSingle()

  // 404 rather than 403. Confirming an admin area exists is free
  // reconnaissance for anyone probing.
  if (!me) return json({ error: "Not found." }, 404)

  let body: { action?: string; [k: string]: unknown }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const action = String(body.action ?? "stats")

  if (DESTRUCTIVE.has(action) && me.role !== "owner") {
    return json({ error: "This action needs an owner account." }, 403)
  }

  try {
    switch (action) {
      case "stats":
        return json(await stats(admin))
      case "parents":
        return json(await parents(admin, callerId))
      case "families":
        return json(await families(admin))
      case "setPlan":
        return json(await setPlan(admin, String(body.householdId), String(body.plan)))
      case "setBan":
        return json(await setBan(admin, String(body.userId), Boolean(body.banned), callerId))
      case "deleteUser":
        return json(await deleteUser(admin, String(body.userId), callerId))
      case "deleteHousehold":
        return json(await deleteHousehold(admin, String(body.householdId)))
      default:
        return json({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, 500)
  }
})

/* ------------------------------------------------------------------ reads */

async function stats(admin: SupabaseClient) {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()

  const [households, members, children, subs, downloads, recentHouseholds, recentChildren] =
    await Promise.all([
      admin.from("households").select("id, plan, created_at"),
      admin.from("household_members").select("user_id"),
      admin.from("children").select("id, enrolled_at"),
      admin.from("subscriptions").select("status, plan"),
      admin.from("app_downloads").select("at, variant, country").gte("at", weekAgo),
      admin.from("households").select("name, created_at").order("created_at", { ascending: false }).limit(5),
      admin
        .from("children")
        .select("name, enrolled_at")
        .not("enrolled_at", "is", null)
        .order("enrolled_at", { ascending: false })
        .limit(5),
    ])

  const houseRows = households.data ?? []
  const childRows = children.data ?? []
  const subRows = subs.data ?? []
  const dlRows = downloads.data ?? []

  const days: { day: string; parent: number; child: number }[] = []
  for (let i = 6; i >= 0; i--) {
    days.push({
      day: new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10),
      parent: 0,
      child: 0,
    })
  }
  for (const row of dlRows) {
    const b = days.find((d) => d.day === String(row.at).slice(0, 10))
    if (!b) continue
    if (row.variant === "child") b.child += 1
    else b.parent += 1
  }

  return {
    totals: {
      households: houseRows.length,
      parents: new Set((members.data ?? []).map((m) => m.user_id as string)).size,
      children: childRows.length,
      childrenEnrolled: childRows.filter((c) => c.enrolled_at).length,
      subscriptions: subRows.length,
      downloads7d: dlRows.length,
      countries: new Set(dlRows.map((d) => d.country).filter(Boolean)).size,
    },
    downloadsByDay: days,
    subscriptionsByStatus: tally(subRows.map((s) => (s.status as string) ?? "unknown")),
    planMix: tally(houseRows.map((h) => (h.plan as string) ?? "free")),
    topCountries: Object.entries(tally(dlRows.map((d) => (d.country as string) ?? "").filter(Boolean)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([country, count]) => ({ country, count })),
    recent: [
      ...(recentHouseholds.data ?? []).map((h) => ({
        label: `New family: ${h.name}`,
        at: h.created_at as string,
      })),
      ...(recentChildren.data ?? []).map((c) => ({
        label: `Child phone linked: ${c.name}`,
        at: c.enrolled_at as string,
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 8),
    generatedAt: now.toISOString(),
  }
}

/**
 * Every parent, with the family they belong to.
 *
 * Reads the auth user list, which is the only place email, last sign-in and ban
 * state live. Paged rather than assumed to fit in one response.
 */
async function parents(admin: SupabaseClient, callerId: string) {
  const users: {
    id: string
    email: string | null
    created_at: string
    last_sign_in_at: string | null
    banned_until: string | null
  }[] = []

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        // Supabase reports a past date for an expired ban; only a future one
        // actually blocks sign-in.
        banned_until: (u as { banned_until?: string }).banned_until ?? null,
      })
    }
    if (data.users.length < 200) break
  }

  const [{ data: members }, { data: houses }, { data: admins }] = await Promise.all([
    admin.from("household_members").select("household_id, user_id, role"),
    admin.from("households").select("id, name, plan"),
    admin.from("admin_users").select("user_id, role"),
  ])

  const houseById = new Map((houses ?? []).map((h) => [h.id as string, h]))
  const adminById = new Map((admins ?? []).map((a) => [a.user_id as string, a.role as string]))
  const memberOf = new Map<string, { id: string; name: string; plan: string; role: string }[]>()
  for (const m of members ?? []) {
    const h = houseById.get(m.household_id as string)
    if (!h) continue
    const list = memberOf.get(m.user_id as string) ?? []
    list.push({
      id: h.id as string,
      name: h.name as string,
      plan: (h.plan as string) ?? "free",
      role: (m.role as string) ?? "member",
    })
    memberOf.set(m.user_id as string, list)
  }

  const now = Date.now()
  return {
    parents: users.map((u) => ({
      ...u,
      banned: u.banned_until ? new Date(u.banned_until).getTime() > now : false,
      households: memberOf.get(u.id) ?? [],
      adminRole: adminById.get(u.id) ?? null,
      isSelf: u.id === callerId,
    })),
  }
}

async function families(admin: SupabaseClient) {
  const [{ data: houses }, { data: members }, { data: children }, { data: subs }] =
    await Promise.all([
      admin.from("households").select("id, name, plan, plan_expires_at, created_at").order("created_at"),
      admin.from("household_members").select("household_id, user_id"),
      admin.from("children").select("id, household_id, name, enrolled_at"),
      admin.from("subscriptions").select("household_id, provider, plan, status, current_period_end"),
    ])

  const subByHouse = new Map((subs ?? []).map((s) => [s.household_id as string, s]))

  return {
    families: (houses ?? []).map((h) => {
      const id = h.id as string
      const kids = (children ?? []).filter((c) => c.household_id === id)
      const sub = subByHouse.get(id)
      return {
        id,
        name: h.name as string,
        plan: (h.plan as string) ?? "free",
        planExpiresAt: (h.plan_expires_at as string) ?? null,
        createdAt: h.created_at as string,
        adults: (members ?? []).filter((m) => m.household_id === id).length,
        children: kids.length,
        childrenEnrolled: kids.filter((c) => c.enrolled_at).length,
        subscription: sub
          ? {
              provider: sub.provider as string,
              plan: sub.plan as string,
              status: sub.status as string,
              currentPeriodEnd: (sub.current_period_end as string) ?? null,
            }
          : null,
      }
    }),
  }
}

/* ----------------------------------------------------------------- writes */

const PLANS = ["free", "pro", "premium", "family"]

async function setPlan(admin: SupabaseClient, householdId: string, plan: string) {
  if (!PLANS.includes(plan)) throw new Error(`Unknown plan: ${plan}`)
  const { error } = await admin.from("households").update({ plan }).eq("id", householdId)
  if (error) throw new Error(error.message)
  return { ok: true, householdId, plan }
}

/**
 * Bans or restores a parent.
 *
 * A ban blocks sign-in; it does not touch their data, and it is reversible,
 * which is why it exists alongside delete. 100 years stands in for permanent —
 * Supabase takes a duration, not a flag.
 */
async function setBan(
  admin: SupabaseClient,
  userId: string,
  banned: boolean,
  callerId: string,
) {
  // Banning yourself locks you out of the tool you would need to undo it.
  if (userId === callerId) throw new Error("You cannot ban your own account.")

  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? "876000h" : "none",
  })
  if (error) throw new Error(error.message)
  return { ok: true, userId, banned }
}

/**
 * Deletes a parent account.
 *
 * Reports any household left with no adults rather than silently cascading into
 * one. A family whose last parent is gone still holds children, policies and
 * history that nobody can now reach — the admin should see that and decide,
 * not discover it later.
 */
async function deleteUser(admin: SupabaseClient, userId: string, callerId: string) {
  if (userId === callerId) throw new Error("You cannot delete your own account.")

  const { data: mine } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
  const touched = (mine ?? []).map((m) => m.household_id as string)

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw new Error(error.message)

  const orphaned: { id: string; name: string }[] = []
  for (const id of touched) {
    const { count } = await admin
      .from("household_members")
      .select("user_id", { count: "exact", head: true })
      .eq("household_id", id)
    if ((count ?? 0) === 0) {
      const { data: h } = await admin.from("households").select("name").eq("id", id).maybeSingle()
      orphaned.push({ id, name: (h?.name as string) ?? "Unnamed family" })
    }
  }

  return { ok: true, userId, orphaned }
}

/** Removes a family and everything under it. Children cascade from the schema. */
async function deleteHousehold(admin: SupabaseClient, householdId: string) {
  const { error } = await admin.from("households").delete().eq("id", householdId)
  if (error) throw new Error(error.message)
  return { ok: true, householdId }
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}
