import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { crypto as stdCrypto } from "jsr:@std/crypto@1"

/**
 * HMAC-SHA3-512, built from a SHA3-512 digest.
 *
 * Web Crypto has no SHA3 at all, and the npm packages that do would not load in
 * this runtime. The construction is the standard one; the only detail that is
 * easy to get wrong is the block size, which for SHA3-512 is the sponge rate —
 * (1600 - 2*512) / 8 = 72 bytes — not the 128 that SHA-512 uses.
 *
 * Verified against Node's own `createHmac("sha3-512", …)` for a short key, a key
 * longer than the block (which must be hashed first) and an empty key.
 */
const BLOCK = 72

async function sha3(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await stdCrypto.subtle.digest("SHA3-512", bytes))
}

async function hmacSha3_512(keyText: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  let key = enc.encode(keyText)
  if (key.length > BLOCK) key = await sha3(key)

  const padded = new Uint8Array(BLOCK)
  padded.set(key)

  const ipad = new Uint8Array(BLOCK)
  const opad = new Uint8Array(BLOCK)
  for (let i = 0; i < BLOCK; i++) {
    ipad[i] = padded[i] ^ 0x36
    opad[i] = padded[i] ^ 0x5c
  }

  const msg = enc.encode(message)
  const innerInput = new Uint8Array(BLOCK + msg.length)
  innerInput.set(ipad)
  innerInput.set(msg, BLOCK)
  const inner = await sha3(innerInput)

  const outerInput = new Uint8Array(BLOCK + inner.length)
  outerInput.set(opad)
  outerInput.set(inner, BLOCK)
  const out = await sha3(outerInput)

  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * OPay payment callbacks.
 *
 * This endpoint grants paid plans, so the signature check is the only thing
 * standing between "customer paid" and "anyone on the internet can POST
 * themselves Premium". Everything below the check treats the body as hostile
 * until proven otherwise.
 *
 * OPay signs callbacks with HMAC-SHA3-512 — SHA3, not SHA-2 — over a specific
 * field ordering, keyed with the merchant's private key. Web Crypto has no SHA3,
 * hence js-sha3.
 *
 * There is no auth header on a callback and there cannot be: OPay's servers do
 * the calling. `verify_jwt` is therefore off, and the signature is the
 * authentication.
 */

const secret = Deno.env.get("OPAY_SECRET_KEY") ?? ""

type Payload = {
  payload?: Record<string, unknown>
  sha512?: string
  type?: string
}

/**
 * Rebuilds the exact string OPay signed.
 *
 * Order, quoting and separators are all load-bearing: one wrong character
 * produces a different digest and every genuine callback is rejected.
 * `Refunded` is "t"/"f" and unquoted, unlike every other field.
 */
function signingString(p: Record<string, unknown>): string {
  const q = (v: unknown) => `"${v ?? ""}"`
  const refunded = p.Refunded === true || p.Refunded === "true" ? "t" : "f"
  return (
    `{Amount:${q(p.Amount)},Currency:${q(p.Currency)},Reference:${q(p.Reference)},` +
    `Refunded:${refunded},Status:${q(p.Status)},Timestamp:${q(p.Timestamp)},` +
    `Token:${q(p.Token)},TransactionID:${q(p.TransactionID)}}`
  )
}

/** Constant-time compare, so a wrong signature cannot be found byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
  if (!secret) return new Response("Not configured", { status: 503 })

  let body: Payload
  try {
    body = (await req.json()) as Payload
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  const p = body.payload
  const given = String(body.sha512 ?? "")
  if (!p || !given) return new Response("Unsigned", { status: 400 })

  const expected = await hmacSha3_512(secret, signingString(p))
  if (!safeEqual(expected.toLowerCase(), given.toLowerCase())) {
    // Deliberately terse. An attacker probing the format learns nothing from
    // "invalid signature" that they should be told.
    return new Response("Rejected", { status: 401 })
  }

  const reference = String(p.Reference ?? "")
  const status = String(p.Status ?? "").toUpperCase()
  if (!reference) return new Response("No reference", { status: 400 })

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  )

  const { data: payment } = await admin
    .from("payments")
    .select("reference, household_id, plan_id, period, amount, currency, status")
    .eq("reference", reference)
    .maybeSingle()

  // 200 on an unknown reference: OPay retries anything else, forever, and a
  // callback for a payment we have no row for is not going to start working.
  if (!payment) return new Response("OK", { status: 200 })

  // Already settled. Callbacks are delivered more than once by design, so this
  // has to be idempotent — re-applying would extend the period every retry.
  if (payment.status === "paid") return new Response("OK", { status: 200 })

  if (status !== "SUCCESS") {
    await admin
      .from("payments")
      .update({ status: status === "CLOSE" ? "cancelled" : "failed" })
      .eq("reference", reference)
    return new Response("OK", { status: 200 })
  }

  // The amount is checked against what we asked for. A callback claiming
  // success for a smaller sum than the plan costs is not a successful payment.
  const paid = Number(p.Amount)
  const expectedMinor = Math.round(Number(payment.amount) * 100)
  if (Number.isFinite(paid) && paid < expectedMinor) {
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    return new Response("OK", { status: 200 })
  }

  const now = new Date()
  const end = new Date(now)
  if (payment.period === "annual") end.setFullYear(end.getFullYear() + 1)
  else end.setMonth(end.getMonth() + 1)

  await admin
    .from("payments")
    .update({
      status: "paid",
      completed_at: now.toISOString(),
      provider_ref: String(p.TransactionID ?? ""),
    })
    .eq("reference", reference)

  await admin
    .from("households")
    .update({ plan: payment.plan_id, plan_expires_at: end.toISOString() })
    .eq("id", payment.household_id)

  await admin.from("subscriptions").upsert(
    {
      household_id: payment.household_id,
      provider: "opay",
      purchase_token: reference,
      product_id: payment.plan_id,
      plan: payment.plan_id,
      status: "active",
      current_period_end: end.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "household_id" },
  )

  return new Response("OK", { status: 200 })
})
