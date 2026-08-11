import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Cross-household aggregates for the business dashboard.
 *
 * This is the one endpoint that deliberately steps outside row-level security,
 * so the authorisation is the whole point of the file:
 *
 *   1. The gateway rejects anything without a valid JWT (`verify_jwt`).
 *   2. That token is exchanged for a user id against the auth server, so a
 *      forged or expired token cannot name its own subject.
 *   3. That user id must appear in `admin_users`, which is checked on every
 *      request against the table — not read from a claim baked into the token.
 *
 * Only then does the service-role client run. Membership is re-read per request
 * rather than trusted from the JWT because revoking an admin has to take effect
 * now: a token already issued cannot be recalled, but a deleted row is felt on
 * the next call.
 *
 * None of this may ever move into the browser bundle. The service role bypasses
 * RLS entirely, so shipping that key to a client would expose every household in
 * the system to anyone who opened devtools.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })

Deno.serve(async (req: Request) => {
  // 204 takes a null body. Passing one throws, the runtime returns a bare 500
  // with no CORS headers, and the browser reports a network failure.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })

  const authHeader = req.headers.get("Authorization") ?? ""
  const token = authHeader.replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Not signed in." }, 401)

  const url = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

  // Resolve the caller from their token rather than believing the request.
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  const userId = userData?.user?.id
  if (userErr || !userId) return json({ error: "Not signed in." }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: isAdmin } = await admin
    .from("admin_users")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle()

  // 404, not 403. Confirming that an admin area exists to someone who is not an
  // admin is free reconnaissance.
  if (!isAdmin) return json({ error: "Not found." }, 404)

  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()

  const [households, members, children, subs, downloads, recentHouseholds, recentChildren] =
    await Promise.all([
      admin.from("households").select("id, plan, created_at"),
      admin.from("household_members").select("user_id"),
      admin.from("children").select("id, name, enrolled_at, created_at"),
      admin.from("subscriptions").select("household_id, provider, plan, status, current_period_end"),
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
  const downloadRows = downloads.data ?? []

  // Distinct users, because one adult may belong to more than one household.
  const parentIds = new Set((members.data ?? []).map((m) => m.user_id as string))

  const countBy = <T,>(rows: T[], key: (row: T) => string | null) => {
    const out: Record<string, number> = {}
    for (const row of rows) {
      const k = key(row)
      if (!k) continue
      out[k] = (out[k] ?? 0) + 1
    }
    return out
  }

  // Seven dated buckets, including days with nothing, so a sparse chart reads as
  // a quiet week rather than a shorter one.
  const days: { day: string; parent: number; child: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    days.push({ day: d, parent: 0, child: 0 })
  }
  for (const row of downloadRows) {
    const day = String(row.at).slice(0, 10)
    const bucket = days.find((b) => b.day === day)
    if (!bucket) continue
    if (row.variant === "child") bucket.child += 1
    else bucket.parent += 1
  }

  return json({
    totals: {
      households: houseRows.length,
      parents: parentIds.size,
      children: childRows.length,
      childrenEnrolled: childRows.filter((c) => c.enrolled_at).length,
      subscriptions: subRows.length,
      downloads7d: downloadRows.length,
      countries: new Set(downloadRows.map((d) => d.country).filter(Boolean)).size,
    },
    downloadsByDay: days,
    subscriptionsByStatus: countBy(subRows, (s) => (s.status as string) ?? "unknown"),
    // Plan comes off the household, which is the field the app actually reads
    // when it decides how many children are allowed.
    planMix: countBy(houseRows, (h) => (h.plan as string) ?? "free"),
    topCountries: Object.entries(countBy(downloadRows, (d) => (d.country as string) ?? null))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([country, count]) => ({ country, count })),
    recent: [
      ...(recentHouseholds.data ?? []).map((h) => ({
        kind: "household" as const,
        label: `New family: ${h.name}`,
        at: h.created_at as string,
      })),
      ...(recentChildren.data ?? []).map((c) => ({
        kind: "enrolment" as const,
        label: `Child phone linked: ${c.name}`,
        at: c.enrolled_at as string,
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 8),
    generatedAt: now.toISOString(),
  })
})
