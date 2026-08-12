import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { StripeError, stripeKey, stripeRequest } from "../_shared/stripe.ts"

/**
 * Starts a Stripe checkout for a plan, in GBP.
 *
 * Deliberately parallel to `opay-checkout`, with one difference that runs
 * through everything: this sells a real recurring subscription. OPay Cashier can
 * only take a one-off payment, so it sells a fixed period that stops when it
 * stops; Stripe renews until cancelled, which means the period end is Stripe's
 * to declare and `stripe-webhook` follows it rather than computing it here.
 *
 * The amount is never taken from the request — a client that could name its own
 * price would buy Premium for a penny. The plan id is the only thing trusted
 * from the caller, and the price is read server-side from `plan_prices`.
 *
 * Prices are built inline with `price_data` rather than referencing Price
 * objects created in the Stripe dashboard. That keeps one source of truth: an
 * admin changing a price in Admin → Plans & billing changes what is charged,
 * with nothing to remember to mirror in Stripe.
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

type Session = { id: string; url?: string | null }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Sign in first." }, 401)

  if (!stripeKey()) return json({ error: "Card payments are not configured." }, 503)

  const url = Deno.env.get("SUPABASE_URL")!

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
    .eq("currency", "GBP")
    .maybeSingle()

  const amount = Number(period === "annual" ? price?.price_annual : price?.price_monthly)
  if (!price || !Number.isFinite(amount) || amount <= 0) {
    // Better an honest refusal than a checkout for zero pounds.
    return json({ error: "This plan has no pound price set yet." }, 409)
  }

  // An existing customer is reused, so a household that resubscribes keeps one
  // billing history and one saved card rather than accumulating customers.
  const { data: existing } = await admin
    .from("subscriptions")
    .select("provider, provider_customer_id")
    .eq("household_id", householdId)
    .maybeSingle()
  const customerId = existing?.provider === "stripe" ? existing.provider_customer_id : null

  const reference = `nestly-${crypto.randomUUID()}`
  const portal = (Deno.env.get("PORTAL_ORIGIN") ?? "https://nestly-gamma-seven.vercel.app")
    .replace(/\/+$/, "")

  // Written before the customer leaves, exactly as in opay-checkout: if the
  // browser dies on Stripe's page the charge still happened, and the webhook
  // needs something to find by reference.
  const { error: insertErr } = await admin.from("payments").insert({
    reference,
    household_id: householdId,
    plan_id: planId,
    provider: "stripe",
    period,
    amount,
    currency: "GBP",
    created_by: userId,
  })
  if (insertErr) return json({ error: "Could not start checkout." }, 500)

  // Metadata goes on the subscription as well as the session. Session metadata
  // is only readable on `checkout.session.completed`; every later event — the
  // renewal a year from now, the cancellation — arrives carrying the
  // subscription, and without this there would be no way back to the household.
  const metadata = { reference, householdId, planId, period }

  let session: Session
  try {
    session = await stripeRequest<Session>("checkout/sessions", {
      body: {
        mode: "subscription",
        client_reference_id: reference,
        success_url: `${portal}/hub?paid=${encodeURIComponent(reference)}`,
        cancel_url: `${portal}/hub`,
        ...(customerId
          ? { customer: customerId }
          : { customer_email: who?.user?.email ?? undefined }),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              // Stripe takes minor units. Sending 4.99 where 499 is meant
              // charges a hundredth of the price.
              unit_amount: Math.round(amount * 100),
              recurring: { interval: period === "annual" ? "year" : "month" },
              product_data: {
                name: `Nestly ${plan.name}`,
                description: `${plan.name} plan, billed ${period === "annual" ? "yearly" : "monthly"}`,
              },
            },
          },
        ],
        metadata,
        subscription_data: { metadata },
      },
      // Keyed on the reference, which is fresh per attempt: a retried request
      // resumes the same session instead of opening a second subscription.
      idempotencyKey: reference,
    })
  } catch (e) {
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    const message = e instanceof StripeError ? e.message : "Could not reach Stripe."
    return json({ error: message }, 502)
  }

  if (!session.url) {
    await admin.from("payments").update({ status: "failed" }).eq("reference", reference)
    return json({ error: "Stripe did not return a checkout page." }, 502)
  }

  await admin.from("payments").update({ provider_ref: session.id }).eq("reference", reference)

  return json({ checkoutUrl: session.url, reference })
})
