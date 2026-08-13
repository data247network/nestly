import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Starts a Paystack checkout for a plan, in naira.
 *
 * Replaces `opay-checkout`, which could never have worked: OPay routes by the
 * merchant's registered business country and that account is registered in
 * Egypt, so every naira request was refused with a domain error no payload
 * change could fix. Paystack is Nigerian and takes NGN natively.
 *
 * Same shape as the function it replaces, deliberately. The amount is never
 * taken from the request — a client that could name its own price would buy
 * Premium for a kobo — so the plan id is the only thing trusted from the caller
 * and the price is read server-side from `plan_prices`.
 *
 * Sells a fixed period, not a subscription. Paystack can do recurring through
 * Plans, but the naira tier is deliberately the same product OPay sold: one
 * month or one year, paid up front, nothing auto-renewing. Stripe remains the
 * recurring path, in GBP.
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

type InitResponse = {
  status?: boolean
  message?: string
  data?: { authorization_url?: string; reference?: string; access_code?: string }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Sign in first." }, 401)

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim()
  if (!secret) return json({ error: "Naira payments are not configured." }, 503)

  const url = Deno.env.get("SUPABASE_URL")!

  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: who } = await asCaller.auth.getUser()
  const userId = who?.user?.id
  const email = who?.user?.email
  if (!userId) return json({ error: "Sign in first." }, 401)
  // Paystack keys a customer by email and refuses an initialise without one.
  if (!email) return json({ error: "Your account has no email address." }, 409)

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
    return json({ error: "This plan has no naira price set yet." }, 409)
  }

  const reference = `nestly-${crypto.randomUUID()}`
  const portal = (Deno.env.get("PORTAL_ORIGIN") ?? "https://nestly-gamma-seven.vercel.app")
    .replace(/\/+$/, "")

  // Written before the customer leaves. If the browser dies on Paystack's page
  // the charge still happened, and the webhook needs something to find by
  // reference — otherwise a successful payment has no local record at all.
  const { error: insertErr } = await admin.from("payments").insert({
    reference,
    household_id: householdId,
    plan_id: planId,
    provider: "paystack",
    period,
    amount,
    currency: "NGN",
    created_by: userId,
  })
  if (insertErr) return json({ error: "Could not start checkout." }, 500)

  let res: Response
  try {
    res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        // Kobo. Sending 1800 where 180000 is meant charges eighteen naira.
        amount: Math.round(amount * 100),
        currency: "NGN",
        // Our own reference, so the webhook can find the row it wrote above
        // rather than trusting anything the callback carries.
        reference,
        callback_url: `${portal}/hub?paid=${encodeURIComponent(reference)}`,
        metadata: {
          householdId,
          planId,
          period,
          // Shown on the Paystack dashboard's transaction view, which is where
          // anyone reconciling a payment actually looks.
          custom_fields: [
            {
              display_name: "Plan",
              variable_name: "plan",
              value: `Nestly ${plan.name} — ${period === "annual" ? "one year" : "one month"}`,
            },
          ],
        },
      }),
    })
  } catch (e) {
    console.error("paystack-checkout: could not reach Paystack —", e)
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    return json({ error: "Could not reach the payment provider." }, 502)
  }

  const out = (await res.json().catch(() => ({}))) as InitResponse

  if (!res.ok || out.status !== true || !out.data?.authorization_url) {
    // Paystack's own message, in the logs. The equivalent refusal from OPay was
    // swallowed for weeks and left nothing behind but `status = 'failed'`.
    console.error(
      "paystack-checkout: refused — http", res.status,
      "message", out.message ?? "(none)",
    )
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    return json({ error: out.message ?? "The payment provider refused this request." }, 502)
  }

  await admin
    .from("payments")
    .update({ provider_ref: out.data.reference ?? reference })
    .eq("reference", reference)

  return json({ checkoutUrl: out.data.authorization_url, reference })
})
