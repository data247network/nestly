import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * The last hop: turning an urgent event into a buzz in a parent's pocket.
 *
 * Everything below already reached the server within seconds — `child-sync`
 * uploads alerts the moment they happen, ahead of the telemetry batch. What was
 * missing is that the parent had to open Nestly to find out. A zone exit at 3pm
 * read at 6pm is not an alert, it is a log entry.
 *
 * Given a child, this looks for events nobody has been told about, claims them,
 * and pushes one notification per event to every phone in that household.
 *
 * NOT a general-purpose sender. It takes a child id and works out for itself
 * what is worth sending and to whom — a caller cannot name a recipient, choose
 * the text, or push something that did not happen. That is deliberate: this is
 * the one function whose whole job is to make a stranger's phone make a noise,
 * so the set of things it can be made to say is fixed here.
 *
 * Internal only. `verify_jwt` is off, as everywhere else in this project, and
 * the function authenticates the caller itself — against the service role key,
 * which no client ever holds. No CORS headers, because nothing in a browser has
 * any business calling this.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

/**
 * Kinds worth interrupting someone for.
 *
 * Narrower than the alerts feed, which also carries `battery-low` and
 * `site-blocked`. Those belong in a list a parent reads; a phone that buzzes
 * for every blocked ad domain is a phone with notifications turned off by the
 * end of the week, and then the tamper alert does not arrive either.
 *
 * Must match the partial index in the push_notifications migration.
 */
const PUSH_KINDS = ["zone-enter", "zone-leave", "filter-off", "contact-added", "tamper"]

/**
 * How stale an event may be and still be worth a notification.
 *
 * A child's phone that has been out of signal since breakfast flushes its whole
 * backlog the moment it reconnects. Without this, that is forty notifications
 * at once, describing a morning that is already over.
 */
const MAX_AGE_MS = 10 * 60 * 1000

/** Newest first. The rest of a burst is stamped and left in the feed. */
const MAX_PER_CALL = 5

/** Ceiling on one call's work, so a pathological backlog cannot run long. */
const MAX_CLAIM = 50

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"

/** Must match ALERT_CHANNEL_ID in src/platform/push.ts and the manifest. */
const CHANNEL_ID = "nestly-alerts"

type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

type PendingEvent = {
  id: number
  kind: string
  ref: string | null
  ts: string
}

/** Constant-time compare, so the key cannot be recovered byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/* ------------------------------------------------------------------ auth -- */

const utf8 = (s: string) => new TextEncoder().encode(s)

function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** The DER body of a PEM private key, which is what WebCrypto imports. */
function derFromPem(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  const raw = atob(body)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Cached across invocations of a warm instance.
 *
 * Google's tokens last an hour and minting one costs an RSA signature plus a
 * round trip to oauth2.googleapis.com. Doing that per alert would put a foreign
 * network call on the critical path of the most time-sensitive thing the
 * product does.
 */
let cached: { value: string; expiresAt: number } | null = null

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now()
  // A minute's headroom: a token that expires in transit fails the send, and
  // the event has already been claimed by then.
  if (cached && cached.expiresAt > now + 60_000) return cached.value

  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI
  const iat = Math.floor(now / 1000)
  const header = { alg: "RS256", typ: "JWT" }
  const claims = { iss: sa.client_email, scope: FCM_SCOPE, aud: tokenUri, iat, exp: iat + 3600 }

  const unsigned =
    `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(claims)))}`

  const key = await crypto.subtle.importKey(
    "pkcs8",
    derFromPem(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(unsigned)),
  )

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(signature)}`,
    }),
  })

  if (!res.ok) {
    // Almost always a rotated or revoked key, and worth saying so plainly —
    // this is the failure that leaves push silently dead for everyone.
    throw new Error(`Google refused the service account (${res.status}).`)
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error("Google returned no access token.")

  cached = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 }
  return body.access_token
}

/* ------------------------------------------------------------------ text -- */

/**
 * What the notification says.
 *
 * Wording tracks `alertFor` in src/app/store.tsx on purpose: a parent who
 * unlocks the phone after reading the banner should find the same sentence in
 * the feed, not a second paraphrase of the same event.
 *
 * The child's name is the title, so a household with three children can tell
 * whose phone this is about from the shade without opening anything.
 */
function describe(kind: string, ref: string | null): string | null {
  switch (kind) {
    case "zone-enter":
      return `Arrived at ${ref ?? "a zone"}`
    case "zone-leave":
      return `Left ${ref ?? "a zone"}`
    case "filter-off":
      return "Web filtering was turned off on their phone"
    case "tamper":
      return `Protection turned off — ${ref ?? "unknown"}`
    case "contact-added":
      return `New contact added — ${ref ?? "unnamed"}`
    default:
      return null
  }
}

/* ------------------------------------------------------------------ send -- */

type SendOutcome = "sent" | "dead" | "failed"

async function sendOne(
  bearer: string,
  projectId: string,
  token: string,
  childId: string,
  childName: string,
  event: PendingEvent,
  body: string,
): Promise<SendOutcome> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: childName, body },
        android: {
          // Wakes a dozing phone. Normal priority is batched by Android until
          // the device next comes out of Doze, which for an overnight tamper
          // alert can be hours.
          priority: "HIGH",
          notification: {
            // Without this the system files the alert under a channel it
            // invents, which is silent from Android 8 onward.
            channel_id: CHANNEL_ID,
            notification_priority: "PRIORITY_MAX",
            default_sound: true,
            default_vibrate_timings: true,
            // One live notification per child per kind. A second "left Home"
            // replaces the first rather than stacking, but a tamper alert never
            // displaces a zone alert.
            tag: `${childId}-${event.kind}`,
          },
        },
        // Strings only — FCM rejects anything else in `data`.
        data: {
          kind: event.kind,
          childId,
          eventId: String(event.id),
          title: childName,
          body,
        },
      },
    }),
  })

  if (res.ok) {
    // Deno holds the connection open until the body is read or cancelled, and
    // this loop runs once per token per event.
    await res.body?.cancel()
    return "sent"
  }

  // 404 is FCM's answer for a token that no longer exists: the app was
  // uninstalled, or its data cleared.
  if (res.status === 404) {
    await res.body?.cancel()
    return "dead"
  }

  const detail = (await res.json().catch(() => ({}))) as {
    error?: { details?: { errorCode?: string }[] }
  }
  const code = detail.error?.details?.find((d) => d?.errorCode)?.errorCode

  // Only these two mean *this token* is wrong. A generic INVALID_ARGUMENT is
  // far more often a malformed message than a bad token, and pruning on it
  // would delete every registration in the household over one bad send.
  if (code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH") return "dead"

  return "failed"
}

/* ---------------------------------------------------------------- handler -- */

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!presented || !safeEqual(presented, serviceKey)) {
    return json({ error: "Not authorised." }, 401)
  }

  let childId = ""
  try {
    childId = String(((await req.json()) as { childId?: string }).childId ?? "")
  } catch {
    return json({ error: "Expected JSON." }, 400)
  }
  if (!childId) return json({ error: "A childId is required." }, 400)

  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT")
  if (!raw) return json({ error: "Push is not configured." }, 503)

  let sa: ServiceAccount
  try {
    sa = JSON.parse(raw) as ServiceAccount
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error("incomplete")
  } catch {
    return json({ error: "FCM_SERVICE_ACCOUNT is not a valid service account key." }, 503)
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: child } = await admin
    .from("children")
    .select("id, name, household_id")
    .eq("id", childId)
    .maybeSingle()
  if (!child) return json({ error: "No such child." }, 404)

  // Claim before sending, not after.
  //
  // Two syncs arriving together would otherwise both read the same pending rows
  // and both send, and a parent would get the same alert twice. The conditional
  // update is the lock: only the rows this call actually flipped come back, so
  // whichever caller wins gets the work and the other gets nothing.
  //
  // Everything considered is stamped, including events too old to send and
  // events with nobody to send them to. `notified_at` means "this has been
  // through the notifier", which keeps the pending index empty rather than
  // letting a household that never registered a phone accumulate for ever.
  const { data: candidates } = await admin
    .from("child_events")
    .select("id")
    .eq("child_id", childId)
    .is("notified_at", null)
    .in("kind", PUSH_KINDS)
    .order("ts", { ascending: false })
    .limit(MAX_CLAIM)

  const ids = (candidates ?? []).map((row) => row.id as number)
  if (ids.length === 0) return json({ ok: true, claimed: 0, sent: 0 })

  const { data: claimed, error: claimError } = await admin
    .from("child_events")
    .update({ notified_at: new Date().toISOString() })
    .in("id", ids)
    .is("notified_at", null)
    .select("id, kind, ref, ts")

  if (claimError) return json({ error: "Could not claim events." }, 500)

  const events = ((claimed ?? []) as PendingEvent[])
    .filter((e) => Date.now() - new Date(e.ts).getTime() <= MAX_AGE_MS)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, MAX_PER_CALL)
    // Oldest first, so the newest alert ends up on top of the shade.
    .reverse()

  if (events.length === 0) return json({ ok: true, claimed: ids.length, sent: 0 })

  // Every adult on the account, not just the one who set the child up. A second
  // parent who hears nothing about a tamper alert is the case this exists for.
  const { data: members } = await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", child.household_id)

  const userIds = (members ?? []).map((m) => m.user_id as string)
  if (userIds.length === 0) return json({ ok: true, claimed: ids.length, sent: 0 })

  const { data: tokens } = await admin
    .from("device_tokens")
    .select("token")
    .in("user_id", userIds)

  const targets = (tokens ?? []).map((t) => t.token as string)
  if (targets.length === 0) return json({ ok: true, claimed: ids.length, sent: 0 })

  let bearer: string
  try {
    bearer = await accessToken(sa)
  } catch (e) {
    // The events stay claimed. Re-sending a stale batch after a credentials
    // outage would buzz a parent about a walk home that finished an hour ago.
    console.error("push-notify: could not mint an FCM token —", e)
    return json({ error: "Could not authenticate with Firebase." }, 502)
  }

  const childName = (child.name as string) || "Your child"
  const dead = new Set<string>()
  let sent = 0

  for (const event of events) {
    const body = describe(event.kind, event.ref)
    if (!body) continue

    const outcomes = await Promise.all(
      targets
        .filter((t) => !dead.has(t))
        .map(async (token) => {
          try {
            return [token, await sendOne(bearer, sa.project_id, token, childId, childName, event, body)] as const
          } catch {
            return [token, "failed" as SendOutcome] as const
          }
        }),
    )

    for (const [token, outcome] of outcomes) {
      if (outcome === "sent") sent++
      else if (outcome === "dead") dead.add(token)
    }
  }

  // Uninstalled apps and cleared data leave tokens behind for ever otherwise,
  // and every later send pays for them.
  if (dead.size > 0) {
    await admin.from("device_tokens").delete().in("token", [...dead])
  }

  return json({ ok: true, claimed: ids.length, notified: events.length, sent, pruned: dead.size })
})
