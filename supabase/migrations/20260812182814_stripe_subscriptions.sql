-- Stripe sells a real recurring subscription, which the schema was not built for.
--
-- OPay cannot do recurring at all, so `subscriptions` was shaped around a fixed
-- period bought outright: `purchase_token` held our own payment reference and
-- nothing ever renewed. A Stripe subscription instead has a life of its own on
-- Stripe's side — it renews, goes past due, and is cancelled — and the webhook
-- has to be able to find the household each of those events belongs to.

-- The Stripe customer, kept because the Billing Portal is addressed by customer
-- and not by subscription. Without it a parent can start a subscription and has
-- no way to stop one, which is not a thing to ship.
alter table public.subscriptions
  add column if not exists provider_customer_id text;

-- `purchase_token` carries the Stripe subscription id for stripe rows, so the
-- webhook can resolve a household from a subscription event whose metadata has
-- been lost. Partial, because OPay writes a payment reference into the same
-- column and those are unrelated values.
create index if not exists subscriptions_purchase_token
  on public.subscriptions (purchase_token)
  where provider = 'stripe';

-- Renewals are recorded as payments too, so a year-old household has a history
-- rather than a single row from the day they signed up.
create index if not exists payments_household_created
  on public.payments (household_id, created_at desc);
