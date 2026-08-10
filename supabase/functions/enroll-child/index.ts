import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Redeems a child enrolment code.
 *
 * `verify_jwt` is off deliberately, and it is the whole reason this function
 * exists. The device calling it is a child's phone with no account and no
 * session — Nestly never makes a child sign in to be supervised. The invite
 * code *is* the credential, so authentication happens in this body rather than
 * at the gateway.
 *
 * That makes the checks below load-bearing:
 *   - the code must exist, be unexpired and unredeemed
 *   - redemption is a conditional UPDATE, so two devices racing the same code
 *     cannot both win
 *   - the returned secret is generated here and never travels in a request
 */

/**
 * CORS is not optional here, and it is not decoration.
 *
 * The only caller that matters is a Capacitor WebView, whose origin is
 * `https://localhost`. A POST carrying `content-type: application/json` and an
 * `apikey` header is not a simple request, so the browser sends an OPTIONS
 * preflight first and refuses to send the real request unless that preflight
 * answers with these headers. Edge functions get no CORS handling for free —
 * unlike the auth and REST endpoints, which is why sign-in worked while this
 * did not.
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

Deno.serve(async (req: Request) => {
  // 204 is a null-body status: passing a body to the Response constructor
  // throws, the runtime turns that into a bare 500 with no CORS headers, and
  // the preflight fails. The device then reports "no connection" — which looks
  // like a network fault on the child's phone and is nothing of the kind.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: { code?: string; deviceId?: string; deviceName?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Expected JSON." }, 400)
  }

  // Normalised the way a parent would read it out: case-insensitive, and
  // tolerant of the spaces and dashes people add when typing a grouped code.
  const code = (body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  const deviceId = (body.deviceId ?? "").trim()

  if (code.length !== 8) return json({ error: "That code doesn't look right." }, 400)
  if (!deviceId) return json({ error: "Missing device id." }, 400)

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  )

  const { data: invite, error } = await admin
    .from("child_invites")
    .select("code, child_id, household_id, expires_at, redeemed_at, redeemed_device_id")
    .eq("code", code)
    .maybeSingle()

  if (error) return json({ error: "Could not check that code." }, 500)
  if (!invite) return json({ error: "That code was not recognised." }, 404)

  // Re-running enrolment on the same device is not an error. A child who
  // reinstalls, or taps the link twice, should land back where they were
  // rather than being told their code is spent.
  const sameDevice = invite.redeemed_at && invite.redeemed_device_id === deviceId

  if (invite.redeemed_at && !sameDevice) {
    return json({ error: "That code has already been used." }, 409)
  }
  if (!invite.redeemed_at && new Date(invite.expires_at) < new Date()) {
    return json({ error: "That code has expired. Ask for a new one." }, 410)
  }

  const { data: child } = await admin
    .from("children")
    .select("id, name, avatar, device_secret")
    .eq("id", invite.child_id)
    .maybeSingle()

  if (!child) return json({ error: "That child no longer exists." }, 404)

  // Reuse the existing secret when the same device re-enrols, so a reinstall
  // does not invalidate a device that is legitimately already bound.
  const secret = sameDevice && child.device_secret
    ? child.device_secret
    : crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "")

  if (!sameDevice) {
    // Conditional on redeemed_at still being null: if two devices submit the
    // same code at once, exactly one UPDATE matches a row and the other gets
    // zero and is rejected. Checking first and writing after would let both
    // through.
    const { data: claimed, error: claimErr } = await admin
      .from("child_invites")
      .update({ redeemed_at: new Date().toISOString(), redeemed_device_id: deviceId })
      .eq("code", code)
      .is("redeemed_at", null)
      .select("code")

    if (claimErr) return json({ error: "Could not complete setup." }, 500)
    if (!claimed || claimed.length === 0) {
      return json({ error: "That code has already been used." }, 409)
    }

    const { error: bindErr } = await admin
      .from("children")
      .update({
        device_id: deviceId,
        device_secret: secret,
        enrolled_at: new Date().toISOString(),
        ...(body.deviceName ? { name: child.name || body.deviceName } : {}),
      })
      .eq("id", child.id)

    if (bindErr) return json({ error: "Could not link this phone." }, 500)
  }

  return json({
    childId: child.id,
    householdId: invite.household_id,
    name: child.name,
    avatar: child.avatar,
    deviceSecret: secret,
  })
})
