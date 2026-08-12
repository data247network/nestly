import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Starts an OPay checkout for a plan.
 *
 * The amount is never taken from the request. A client that could name its own
 * price would buy Premium for a penny, so the plan id is the only thing trusted
 * from the caller and the price is looked up server-side from `plan_prices`.
 *
 * A `payments` row is written *before* the customer leaves. If the browser dies
 * on OPay's page the charge still happened, and the webhook needs something to
 * find by reference — otherwise a successful payment has no local record at all.
 *
 * OPay Cashier is a one-off payment, not a recurring subscription. What is being
 * sold here is therefore a fixed period: one month or one year, paid up front,
 * with `current_period_end` set on success. Nothing auto-renews, which is the
 * honest description of what OPay can actually do here.
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

/** Live unless explicitly told otherwise, so a test key cannot silently ship. */
const OPAY_BASE = Deno.env.get("OPAY_ENV") === "sandbox"
  ? "https://testapi.opaycheckout.com"
  : "https://liveapi.opaycheckout.com"

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Sign in first." }, 401)

  const url = Deno.env.get("SUPABASE_URL")!
  const publicKey = Deno.env.get("OPAY_PUBLIC_KEY")
  const merchantId = Deno.env.get("OPAY_MERCHANT_ID")
  if (!publicKey || !merchantId) {
    return json({ error: "Payments are not configured." }, 503)
  }

  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: who } = await asCaller.auth.getUser()
  const userId = who?.user?.id
  if (!userId) return json({ error: "Sign in first." }, 401)

  let body: { householdId?: string; planId?: string; period?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Expected JSON." }, 400)
  }

  const householdId = String(body.householdId ?? "")
  const planId = String(body.planId ?? "")
  const period = body.period === "annual" ? "annual" : "monthly"
  if (!householdId || !planId) return json({ error: "Missing household or plan." }, 400)

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  })

  // The caller must belong to the household they are paying for. Without this
  // anyone could upgrade — or rather, be billed for — someone else's family.
  const { data: membership } = await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!membership) return json({ error: "That is not your family." }, 403)

  const { data: plan } = await admin
    .from("plans")
    .select("id, name, active")
    .eq("id", planId)
    .maybeSingle()
  if (!plan || !plan.active) return json({ error: "That plan is not available." }, 400)

  const { data: price } = await admin
    .from("plan_prices")
    .select("price_monthly, price_annual")
    .eq("plan_id", planId)
    .eq("currency", "NGN")
    .maybeSingle()

  const amount = Number(period === "annual" ? price?.price_annual : price?.price_monthly)
  if (!price || !Number.isFinite(amount) || amount <= 0) {
    // Better an honest refusal than a checkout for zero naira.
    return json({ error: "This plan has no naira price set yet." }, 409)
  }

  const reference = `nestly-${crypto.randomUUID()}`
  const portal = (Deno.env.get("PORTAL_ORIGIN") ?? "https://nestly-gamma-seven.vercel.app")
    .replace(/\/+$/, "")

  const { error: insertErr } = await admin.from("payments").insert({
    reference,
    household_id: householdId,
    plan_id: planId,
    provider: "opay",
    period,
    amount,
    currency: "NGN",
    created_by: userId,
  })
  if (insertErr) return json({ error: "Could not start checkout." }, 500)

  // OPay takes minor units, so naira are sent as kobo. Sending 4.99 where 499
  // is meant charges a hundredth of the price.
  const payload = {
    country: "NG",
    reference,
    amount: { total: Math.round(amount * 100), currency: "NGN" },
    returnUrl: `${portal}/hub?paid=${encodeURIComponent(reference)}`,
    cancelUrl: `${portal}/hub`,
    callbackUrl: `${url}/functions/v1/opay-webhook`,
    expireAt: 30,
    userInfo: {
      userId,
      userEmail: who?.user?.email ?? "",
      userName: who?.user?.email ?? "Nestly parent",
    },
    product: {
      name: `Nestly ${plan.name}`,
      description: `${plan.name} plan, ${period === "annual" ? "one year" : "one month"}`,
    },
  }

  let res: Response
  try {
    res = await fetch(`${OPAY_BASE}/api/v1/international/cashier/create`, {
      method: "POST",
      headers: {
        // Creating a payment authenticates with the PUBLIC key. The secret key
        // is only for signature-authenticated calls (status, refund) and for
        // verifying callbacks — sending it here would leak it to no purpose.
        Authorization: `Bearer ${publicKey}`,
        MerchantId: merchantId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  } catch {
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    return json({ error: "Could not reach the payment provider." }, 502)
  }

  const out = (await res.json().catch(() => ({}))) as {
    code?: string
    message?: string
    data?: { cashierUrl?: string; orderNo?: string }
  }

  if (out.code !== "00000" || !out.data?.cashierUrl) {
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    return json({ error: out.message ?? "The payment provider refused this request." }, 502)
  }

  await admin
    .from("payments")
    .update({ provider_ref: out.data.orderNo ?? null })
    .eq("reference", reference)

  return json({ checkoutUrl: out.data.cashierUrl, reference })
})
