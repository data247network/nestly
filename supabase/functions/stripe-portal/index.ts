import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { StripeError, stripeKey, stripeRequest } from "../_shared/stripe.ts"

/**
 * Opens Stripe's Billing Portal for a household.
 *
 * The other half of selling a subscription. OPay sells a fixed period that
 * simply runs out, so there was never anything to cancel; a Stripe subscription
 * renews until someone stops it, and a subscription a parent cannot cancel from
 * inside the product is not something to ship — quite apart from what UK
 * consumer rules have to say about it.
 *
 * Stripe hosts the portal, which is the point: cancelling, changing the card and
 * downloading invoices are all handled there, and no card details ever touch
 * this codebase. The resulting cancellation comes back as a webhook like any
 * other change, so there is one path into the database rather than two.
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

  let householdId = ""
  try {
    householdId = String(((await req.json()) as { householdId?: string }).householdId ?? "")
  } catch {
    return json({ error: "Expected JSON." }, 400)
  }
  if (!householdId) return json({ error: "Missing household." }, 400)

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  })

  // Same check as checkout: managing a household's billing is as sensitive as
  // starting it, and this reveals payment history.
  const { data: membership } = await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!membership) return json({ error: "That is not your family." }, 403)

  const { data: sub } = await admin
    .from("subscriptions")
    .select("provider, provider_customer_id")
    .eq("household_id", householdId)
    .maybeSingle()

  if (sub?.provider !== "stripe" || !sub.provider_customer_id) {
    // Distinct from an error: a household paying through OPay has no Stripe
    // customer, and never will. Saying so beats a Stripe error page.
    return json({ error: "This family has no card subscription to manage." }, 409)
  }

  const portal = (Deno.env.get("PORTAL_ORIGIN") ?? "https://nestly-gamma-seven.vercel.app")
    .replace(/\/+$/, "")

  try {
    const session = await stripeRequest<{ url?: string }>("billing_portal/sessions", {
      body: { customer: sub.provider_customer_id, return_url: `${portal}/hub` },
    })
    if (!session.url) return json({ error: "Stripe did not return a portal link." }, 502)
    return json({ portalUrl: session.url })
  } catch (e) {
    // The first call fails until the portal has a default configuration saved in
    // the Stripe dashboard, and Stripe's own message says so precisely. Passing
    // it through beats replacing it with something vaguer.
    const message = e instanceof StripeError ? e.message : "Could not reach Stripe."
    return json({ error: message }, 502)
  }
})
