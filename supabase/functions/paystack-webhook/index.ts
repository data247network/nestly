import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Paystack payment events.
 *
 * This endpoint grants paid plans, so the signature check is the only thing
 * standing between "customer paid" and "anyone on the internet can POST
 * themselves Premium". There is no auth header on a webhook and there cannot
 * be — Paystack's servers do the calling — so `verify_jwt` is off and the
 * signature is the authentication.
 *
 * Paystack has no separate webhook signing secret, unlike Stripe: the header
 * `x-paystack-signature` is HMAC-SHA512 of the raw body keyed with the *secret
 * API key*. One less secret to configure, and one more reason that key must
 * never reach a client.
 *
 * The amount is re-checked against what was asked for. A callback claiming
 * success for less than the plan costs is not a successful payment.
 */

const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim() ?? ""

/** Constant-time compare, so a wrong signature cannot be found byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function expectedSignature(rawBody: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  )
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)))
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
  if (!secret) return new Response("Not configured", { status: 503 })

  // The exact bytes received. Re-serialising the parsed JSON changes key order
  // and whitespace, and the signature would never match again.
  const raw = await req.text()
  const given = req.headers.get("x-paystack-signature") ?? ""

  if (!given || !safeEqual(given.toLowerCase(), await expectedSignature(raw))) {
    // Terse over the wire, specific in the logs — a mismatch here nearly always
    // means the key in PAYSTACK_SECRET_KEY is not the one this account signs
    // with, most often a test key against live traffic or the reverse.
    console.error("paystack-webhook: rejected —", given ? "digest-mismatch" : "no-signature")
    return new Response("Rejected", { status: 401 })
  }

  let event: { event?: string; data?: Record<string, unknown> }
  try {
    event = JSON.parse(raw)
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  // Everything else is acknowledged and ignored. An endpoint subscribed to more
  // events than it handles should not look like an outage on Paystack's side.
  if (event.event !== "charge.success") return new Response("OK", { status: 200 })

  const data = event.data ?? {}
  const reference = String(data.reference ?? "")
  if (!reference) return new Response("No reference", { status: 200 })

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  )

  const { data: payment } = await admin
    .from("payments")
    .select("reference, household_id, plan_id, period, amount, status")
    .eq("reference", reference)
    .maybeSingle()

  // 200 on an unknown reference: Paystack retries anything else, and a callback
  // for a payment we have no row for is not going to start working.
  if (!payment) return new Response("OK", { status: 200 })

  // Already settled. Webhooks are delivered more than once by design, so this
  // has to be idempotent — re-applying would extend the period every retry.
  if (payment.status === "paid") return new Response("OK", { status: 200 })

  if (String(data.status ?? "").toLowerCase() !== "success") {
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    return new Response("OK", { status: 200 })
  }

  const paid = Number(data.amount)
  const expectedMinor = Math.round(Number(payment.amount) * 100)
  if (Number.isFinite(paid) && paid < expectedMinor) {
    console.error("paystack-webhook: underpaid", reference, paid, "<", expectedMinor)
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
      provider_ref: String(data.id ?? reference),
    })
    .eq("reference", reference)

  await admin
    .from("households")
    .update({ plan: payment.plan_id, plan_expires_at: end.toISOString() })
    .eq("id", payment.household_id)

  await admin.from("subscriptions").upsert(
    {
      household_id: payment.household_id,
      provider: "paystack",
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
