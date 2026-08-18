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
const MAX_NOTES = 50
const MAX_NOTE_ACKS = 100
/** Longest a note may be. Generous for a note; short of a denial of service. */
const MAX_NOTE_LENGTH = 2000

/** How much of the thread a child device is handed back. */
const NOTE_WINDOW_DAYS = 14
const NOTE_PAGE = 50

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
  /** Notes this child has written. `from` is ignored — see below. */
  notes?: { id: string; text: string; ts: number }[]
  /** Ids of the parent's notes this device has durably stored. */
  noteAcks?: string[]
  /** Ids of this child's own notes it is still waiting on a receipt for. */
  notePending?: string[]
  /** Whether to send the thread back. Skipped on plain telemetry pushes. */
  wantNotes?: boolean
  /** A fix taken because a parent asked, rather than on the timer. */
  locateFix?: { lat: number; lng: number; acc?: number; ts?: number }
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
  let eventsUpTo: number | undefined

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
    if (error) {
      console.error("child-sync: telemetry write failed", error)
      return json({ ok: false, error: "telemetry_write_failed" }, 500)
    }
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
    if (error) {
      console.error("child-sync: event write failed", error)
      return json({ ok: false, error: "event_write_failed" }, 500)
    }
    eventsUpTo = Math.max(...events.map((event) => event.seq))

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
    if (error) {
      console.error("child-sync: usage write failed", error)
      return json({ ok: false, error: "usage_write_failed" }, 500)
    }
  }

  /* ------------------------------------------------------------------ notes */
  //
  // Notes used to cross over Bluetooth only, which meant a parent at work could
  // not leave one for a child at school — the one thing anybody would expect an
  // internet connection to buy them. This is the child's half of that: it can
  // neither read nor write the `notes` table directly, because it has no account
  // to be scoped by, so the same device secret that authenticates telemetry
  // carries the thread.

  if (Array.isArray(body.notes) && body.notes.length > 0) {
    const notes = body.notes
      .slice(0, MAX_NOTES)
      .filter((n) => n?.id && typeof n.text === "string" && n.text.trim())

    if (notes.length > 0) {
      // `sender` is set here and never read from the request. A device secret
      // authenticates a child's phone and nothing else — letting it post a note
      // attributed to the parent would put words in their mouth on their own
      // child's screen.
      //
      // ignoreDuplicates for the usual reason: the device resends until it is
      // acknowledged, so a replay is the normal case rather than an error. It
      // also means a client_id that collides with another household's note is a
      // silent no-op instead of an overwrite.
      const { error } = await admin.from("notes").upsert(
        notes.map((n) => ({
          child_id: childId,
          client_id: String(n.id).slice(0, 120),
          sender: "child",
          body: String(n.text).slice(0, MAX_NOTE_LENGTH),
          ts: new Date(n.ts ?? Date.now()).toISOString(),
        })),
        { onConflict: "client_id", ignoreDuplicates: true },
      )
      results.notes = error ? "failed" : notes.length
      if (error) {
        console.error("child-sync: note write failed", error)
        return json({ ok: false, error: "note_write_failed" }, 500)
      }

      // A note nobody is told about is a note that waits until the parent
      // happens to open the app, which for a message is indistinguishable from
      // not sending it. Same notifier as the alerts, and for the same reason it
      // is safe to call on a replay: it works out for itself which rows are new.
      if (!error) await notify(childId)
    }
  }

  if (Array.isArray(body.noteAcks) && body.noteAcks.length > 0) {
    // Scoped to this child and to the parent's own notes, so a device secret
    // can only ever confirm delivery of something addressed to it. Guarded on
    // null so the first receipt is the one that stands.
    const { error } = await admin
      .from("notes")
      .update({ delivered_at: now })
      .eq("child_id", childId)
      .eq("sender", "parent")
      .in("client_id", body.noteAcks.slice(0, MAX_NOTE_ACKS).map(String))
      .is("delivered_at", null)
    results.noteAcks = error ? "failed" : "ok"
    if (error) {
      console.error("child-sync: note acknowledgement failed", error)
      return json({ ok: false, error: "note_ack_failed" }, 500)
    }
  }

  let notesOut: { id: string; from: string; text: string; ts: number }[] | undefined
  let noteDelivered: string[] | undefined

  if (body.wantNotes) {
    const since = new Date(Date.now() - NOTE_WINDOW_DAYS * 86_400_000).toISOString()

    // Recent notes rather than only unacknowledged ones: a phone that has been
    // reinstalled or reset should find the thread where it left it, not an
    // empty screen. The device skips the ones it already holds.
    const { data: thread } = await admin
      .from("notes")
      .select("client_id, body, ts")
      .eq("child_id", childId)
      .eq("sender", "parent")
      .gte("ts", since)
      .order("ts", { ascending: true })
      .limit(NOTE_PAGE)

    notesOut = (thread ?? []).map((r) => ({
      id: r.client_id as string,
      from: "parent",
      text: r.body as string,
      // Epoch milliseconds: the device's thread sorts on the author's clock.
      ts: new Date(r.ts as string).getTime(),
    }))

    const pending = (body.notePending ?? []).slice(0, MAX_NOTE_ACKS).map(String)
    if (pending.length > 0) {
      const { data: receipts } = await admin
        .from("notes")
        .select("client_id")
        .eq("child_id", childId)
        .in("client_id", pending)
        .not("delivered_at", "is", null)
      noteDelivered = (receipts ?? []).map((r) => r.client_id as string)
    }
  }

  /* ----------------------------------------------------------------- locate */
  //
  // "Where are you now?", asked by a parent who is not going to wait out the
  // sixty-second telemetry cadence.
  //
  // Answering comes first, so that a device sending its fix in the same call
  // that would otherwise be told to take one does not go and take a second.

  if (body.locateFix && Number.isFinite(body.locateFix.lat) && Number.isFinite(body.locateFix.lng)) {
    const f = body.locateFix
    // Recorded against the request as well as in telemetry. Telemetry is
    // last-write-wins, so the very fix the parent is watching for can be
    // overwritten by the routine push a second behind it.
    const { error } = await admin
      .from("locate_requests")
      .update({
        served_at: now,
        lat: f.lat,
        lng: f.lng,
        accuracy_m: f.acc ?? null,
        fix_ts: new Date(f.ts ?? Date.now()).toISOString(),
      })
      .eq("child_id", childId)
      .is("served_at", null)
    results.locate = error ? "failed" : "ok"
    if (error) {
      console.error("child-sync: locate response write failed", error)
      return json({ ok: false, error: "locate_write_failed" }, 500)
    }
  }

  // Only an unanswered request counts. Without the null check the device would
  // be asked to fetch a fix on every sync for the rest of the day, which on a
  // child's phone is a GPS lock a minute — and a flat battery by the evening.
  const { data: locate } = await admin
    .from("locate_requests")
    .select("requested_at, served_at")
    .eq("child_id", childId)
    .is("served_at", null)
    .maybeSingle()

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
    ...(eventsUpTo != null ? { eventsUpTo } : {}),
    policy: policy?.body ?? null,
    policyVersion: policy?.version ?? 0,
    ...(notesOut ? { notes: notesOut } : {}),
    ...(noteDelivered ? { noteDelivered } : {}),
    locateNow: Boolean(locate),
  })
})
