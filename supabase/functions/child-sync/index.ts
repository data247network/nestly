import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * The child device's own route to the cloud.
 *
 * Until this existed the cloud only learned anything while the parent's phone
 * was within Bluetooth range with the app open — so a child at school and a
 * parent at work meant nothing reached the server at all. For a safety product
 * that is close to useless, and it is the gap this closes.
 *
 * A child has no account and never signs in; that is a deliberate property of
 * the product, not an oversight. So the credential is the `device_secret` minted
 * at enrolment and stored only on that phone. `verify_jwt` is off because there
 * is no JWT to verify — this function does its own authentication.
 *
 * Bluetooth is unchanged and remains the fallback. Everything here is additive:
 * a child with no signal still enforces routines and logs locally exactly as
 * before, and uploads when it can.
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

/** Caps, so a faulty or hostile device cannot flood the table in one call. */
const MAX_EVENTS = 200
const MAX_APPS = 200
const MAX_SITES = 300

/**
 * Kinds that should reach a parent's phone as a notification rather than
 * waiting to be found in the feed. Must match `PUSH_KINDS` in push-notify,
 * which decides what is actually sent — this is only the trigger.
 */
const NOTIFIABLE: ReadonlySet<string> = new Set([
  "zone-enter",
  "zone-leave",
  "filter-off",
  "contact-added",
  "tamper",
])

/** Bounded, so the child's upload can never be held up by the notifier. */
const NOTIFY_TIMEOUT_MS = 5000

/**
 * Hands the child off to the notifier.
 *
 * Awaited rather than left floating: a promise abandoned after the response is
 * returned may be torn down with the isolate, and push failing silently is
 * exactly the outcome that is hardest to notice. Cheap to wait for — only
 * uploads that actually carry an alert reach here — and any failure is
 * swallowed, because a notification is a convenience on top of an upload that
 * has already succeeded.
 */
async function notify(childId: string): Promise<void> {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/push-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ childId }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
  } catch (e) {
    console.error("child-sync: push-notify failed —", e)
  }
}

/** Constant-time compare, so the secret cannot be recovered byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type Body = {
  childId?: string
  deviceSecret?: string
  telemetry?: {
    ts?: number
    battery?: number | null
    charging?: boolean | null
    fix?: { lat: number; lng: number; acc: number } | null
    activeScenarioId?: string | null
    locked?: boolean
  }
  events?: {
    seq: number
    ts: number
    kind: string
    ref?: string
    cat?: string
    lat?: number
    lng?: number
  }[]
  usage?: {
    day: string
    apps?: unknown[]
    sites?: unknown[]
    usageAccess?: boolean
    filterOn?: boolean
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ error: "Expected JSON." }, 400)
  }

  const childId = String(body.childId ?? "")
  const secret = String(body.deviceSecret ?? "")
  if (!childId || !secret) return json({ error: "Not authorised." }, 401)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  )

  const { data: child } = await admin
    .from("children")
    .select("id, household_id, device_secret")
    .eq("id", childId)
    .maybeSingle()

  // One message for "no such child" and "wrong secret" alike. Distinguishing
  // them would let someone enumerate valid child ids.
  if (!child?.device_secret || !safeEqual(String(child.device_secret), secret)) {
    return json({ error: "Not authorised." }, 401)
  }

  const now = new Date().toISOString()
  const results: Record<string, unknown> = {}

  if (body.telemetry) {
    const t = body.telemetry
    const { error } = await admin.from("child_telemetry").upsert({
      child_id: childId,
      ts: new Date(t.ts ?? Date.now()).toISOString(),
      battery: t.battery ?? null,
      charging: t.charging ?? null,
      lat: t.fix?.lat ?? null,
      lng: t.fix?.lng ?? null,
      accuracy_m: t.fix?.acc ?? null,
      active_scenario_id: t.activeScenarioId ?? null,
      locked: t.locked ?? false,
      updated_at: now,
    })
    results.telemetry = error ? "failed" : "ok"
  }

  if (Array.isArray(body.events) && body.events.length > 0) {
    const events = body.events.slice(0, MAX_EVENTS)
    // ignoreDuplicates because the device resends until acknowledged and seq is
    // unique per child — a replay is the normal case, not an error.
    const { error } = await admin.from("child_events").upsert(
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
      { onConflict: "child_id,seq", ignoreDuplicates: true },
    )
    results.events = error ? "failed" : events.length

    // The upload is already durable at this point, which is the ordering that
    // matters: a notifier that fell over must not cost the parent the event
    // itself. push-notify works out for itself which rows are new — a replayed
    // batch is the normal case here and must not buzz twice.
    if (!error && events.some((e) => NOTIFIABLE.has(e.kind))) {
      await notify(childId)
    }
  }

  if (body.usage?.day) {
    const u = body.usage
    const { error } = await admin.from("child_usage").upsert({
      child_id: childId,
      day: u.day,
      apps: (u.apps ?? []).slice(0, MAX_APPS),
      sites: (u.sites ?? []).slice(0, MAX_SITES),
      usage_access: u.usageAccess ?? false,
      filter_on: u.filterOn ?? false,
      updated_at: now,
    })
    results.usage = error ? "failed" : "ok"
  }

  // The policy the parent last published, so a child that has been out of
  // Bluetooth range for days still picks up a rule change over the internet.
  // Household-wide rows (child_id null) are the fallback when nothing is set
  // specifically for this child.
  const { data: policy } = await admin
    .from("policies")
    .select("version, body, child_id")
    .eq("household_id", child.household_id)
    .or(`child_id.eq.${childId},child_id.is.null`)
    .order("child_id", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()

  return json({
    ok: true,
    serverTime: now,
    accepted: results,
    policy: policy?.body ?? null,
    policyVersion: policy?.version ?? 0,
  })
})
