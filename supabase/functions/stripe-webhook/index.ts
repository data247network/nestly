import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"
import { stripeRequest, verifySignature } from "../_shared/stripe.ts"

/**
 * Stripe events.
 *
 * This endpoint grants paid plans, so the signature check is the only thing
 * standing between "customer paid" and "anyone on the internet can POST
 * themselves Premium". Everything below the check treats the body as hostile
 * until proven otherwise. There is no auth header on a webhook and there cannot
 * be — Stripe's servers do the calling — so `verify_jwt` is off and the
 * signature is the authentication, exactly as in `opay-webhook`.
 *
 * WHY IT FETCHES WHAT IT WAS JUST SENT. Webhook payloads are serialised with the
 * API version pinned to the *endpoint* in Stripe's dashboard, not the version
 * this code asks for — so the shape of an event is set by a dropdown nobody here
 * will remember changing. Fields have genuinely moved between versions
 * (`invoice.subscription` among them). Only ids are read from the payload;
 * everything the database depends on is then fetched back through
 * `stripeRequest`, which pins its version, so the objects this reasons about
 * have one known shape.
 *
 * Everything here is idempotent. Stripe redelivers on any non-2xx and retries
 * for days, and events arrive out of order — a renewal must be safe to apply
 * twice, and a stale event must not undo a newer one.
 */

const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? ""

/** 200 unless we want a retry. Anything else and Stripe keeps knocking. */
const ok = () => new Response("OK", { status: 200 })

type StripeSubscription = {
  id: string
  status: string
  customer: string | { id: string }
  current_period_end?: number
  cancel_at_period_end?: boolean
  metadata?: Record<string, string>
  items?: { data?: { current_period_end?: number }[] }
}

/** Stripe's subscription states, reduced to the four this product acts on. */
function localStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active"
    case "past_due":
    case "unpaid":
      return "past_due"
    case "canceled":
    case "incomplete_expired":
      return "cancelled"
    default:
      return "pending"
  }
}

function periodEnd(sub: StripeSubscription): string | null {
  // Top level through 2024-06-20; newer versions carry it per item. Both are
  // read so that bumping the pinned version cannot silently null this out.
  const seconds = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null
}

function customerId(sub: StripeSubscription): string | null {
  if (typeof sub.customer === "string") return sub.customer
  return sub.customer?.id ?? null
}

/**
 * Finds the household a subscription belongs to.
 *
 * Metadata first, because `stripe-checkout` puts it there for exactly this. The
 * lookup by subscription id is the safety net for a subscription created or
 * edited in the Stripe dashboard, where nobody will have typed the metadata in.
 */
async function resolveHousehold(
  admin: SupabaseClient,
  sub: StripeSubscription,
): Promise<{ householdId: string; planId: string | null } | null> {
  const fromMetadata = sub.metadata?.householdId
  if (fromMetadata) {
    return { householdId: fromMetadata, planId: sub.metadata?.planId ?? null }
  }

  const { data } = await admin
    .from("subscriptions")
    .select("household_id, plan")
    .eq("purchase_token", sub.id)
    .eq("provider", "stripe")
    .maybeSingle()

  if (!data) return null
  return { householdId: data.household_id as string, planId: (data.plan as string) ?? null }
}

/**
 * Writes a subscription's current state through to the household.
 *
 * The single place any Stripe event lands, so renewal, card failure and
 * cancellation cannot drift into three different notions of what being
 * subscribed means.
 */
async function applySubscription(admin: SupabaseClient, sub: StripeSubscription): Promise<void> {
  const found = await resolveHousehold(admin, sub)
  if (!found) {
    // Nothing to attach it to. A 200 keeps Stripe from retrying an event that
    // is never going to resolve — the alternative is a permanent retry loop.
    console.error("stripe-webhook: no household for subscription", sub.id)
    return
  }

  const { householdId } = found
  const status = localStatus(sub.status)
  const end = periodEnd(sub)

  // The plan a cancelled subscription falls back to. `free` is the catalogue's
  // lowest tier and the column default, so this returns the household to where
  // it started rather than inventing a state.
  const planId = status === "cancelled" ? "free" : found.planId

  await admin.from("subscriptions").upsert(
    {
      household_id: householdId,
      provider: "stripe",
      purchase_token: sub.id,
      provider_customer_id: customerId(sub),
      product_id: found.planId,
      plan: planId ?? "free",
      status,
      current_period_end: end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id" },
  )

  // past_due deliberately keeps the plan. Stripe retries a failed card for a
  // fortnight, and cutting a family's safety app off the same hour their card
  // expired is not the behaviour to have. Access ends when Stripe gives up and
  // sends `customer.subscription.deleted`.
  await admin
    .from("households")
    .update({
      plan: planId ?? "free",
      plan_expires_at: status === "cancelled" ? null : end,
    })
    .eq("id", householdId)
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 })
  if (!secret) return new Response("Not configured", { status: 503 })

  // The exact bytes received. Re-serialising the parsed JSON changes key order
  // and whitespace, and the signature would never match again.
  const raw = await req.text()
  const signature = req.headers.get("Stripe-Signature") ?? ""

  if (!signature || !(await verifySignature(raw, signature, secret))) {
    // Deliberately terse. An attacker probing the format learns nothing from
    // "invalid signature" that they should be told.
    return new Response("Rejected", { status: 401 })
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } }
  try {
    event = JSON.parse(raw)
  } catch {
    return new Response("Bad request", { status: 400 })
  }

  const object = event.data?.object ?? {}
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  )

  try {
    switch (event.type) {
      /* ------------------------------------------------ first payment -- */
      case "checkout.session.completed": {
        const reference = String(object.client_reference_id ?? (object.metadata as Record<string, string>)?.reference ?? "")
        const subId = typeof object.subscription === "string" ? object.subscription : null

        // `payment_status` rather than the session merely existing: a session
        // completes in Stripe's sense before an async payment method settles.
        if (object.payment_status !== "paid" && object.payment_status !== "no_payment_required") {
          return ok()
        }

        if (reference) {
          await admin
            .from("payments")
            .update({
              status: "paid",
              completed_at: new Date().toISOString(),
              provider_ref: subId ?? String(object.id ?? ""),
            })
            .eq("reference", reference)
            // Callbacks are delivered more than once by design. Re-applying a
            // settled payment must not overwrite a later state.
            .neq("status", "paid")
        }

        if (subId) {
          await applySubscription(admin, await stripeRequest<StripeSubscription>(`subscriptions/${subId}`, { method: "GET" }))
        }
        return ok()
      }

      /* ----------------------------------------------------- renewals -- */
      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = object as Record<string, any>
        // Where the subscription id lives has moved between API versions, and
        // the payload arrives in whichever version the endpoint is pinned to.
        const subId: string | null =
          (typeof inv.subscription === "string" ? inv.subscription : null) ??
          inv.parent?.subscription_details?.subscription ??
          inv.lines?.data?.[0]?.subscription ??
          null

        if (!subId) return ok()

        const sub = await stripeRequest<StripeSubscription>(`subscriptions/${subId}`, { method: "GET" })
        await applySubscription(admin, sub)

        // A renewal is worth its own row, so a household that has been paying
        // for a year has a history rather than one row from the day they
        // joined. The create invoice is skipped: the checkout row is already it.
        if (event.type === "invoice.paid" && inv.billing_reason !== "subscription_create") {
          const found = await resolveHousehold(admin, sub)
          if (found) {
            await admin.from("payments").upsert(
              {
                reference: `stripe-inv-${inv.id}`,
                household_id: found.householdId,
                plan_id: found.planId ?? "free",
                provider: "stripe",
                period: sub.metadata?.period === "annual" ? "annual" : "monthly",
                amount: Number(inv.amount_paid ?? 0) / 100,
                currency: String(inv.currency ?? "gbp").toUpperCase(),
                status: "paid",
                provider_ref: subId,
                completed_at: new Date().toISOString(),
              },
              { onConflict: "reference", ignoreDuplicates: true },
            )
          }
        }
        return ok()
      }

      /* ------------------------------------- state changes and cancels -- */
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subId = String(object.id ?? "")
        if (!subId) return ok()
        await applySubscription(
          admin,
          await stripeRequest<StripeSubscription>(`subscriptions/${subId}`, { method: "GET" }),
        )
        return ok()
      }

      default:
        // Everything else is acknowledged and ignored. An endpoint subscribed to
        // more events than it handles should not look like an outage in Stripe's
        // dashboard.
        return ok()
    }
  } catch (e) {
    // A 500 asks Stripe to retry, which is what we want for a transient failure
    // — a dropped connection to Stripe or to Postgres. The event is not lost.
    console.error("stripe-webhook:", event.type, e)
    return new Response("Retry", { status: 500 })
  }
})
