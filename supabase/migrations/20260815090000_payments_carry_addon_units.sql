-- What a payment was for, when it was for extra places rather than a plan.
--
-- The units live on the payment row rather than only in provider metadata so
-- that the webhook has one place to read them from regardless of provider:
-- Stripe returns session metadata only on checkout.session.completed, Paystack
-- returns its own shape, and both already look the row up by reference. One
-- source of truth beats two parsers that can disagree about how many children
-- somebody bought.
alter table public.payments
  add column if not exists addon_adults integer not null default 0
    check (addon_adults >= 0 and addon_adults <= 20),
  add column if not exists addon_children integer not null default 0
    check (addon_children >= 0 and addon_children <= 20);

-- Applying a payment twice is the failure that matters here: webhooks are
-- retried, and an add-on granted per delivery would hand a family five extra
-- children for one payment. The stamp is the record that this row has already
-- been counted.
alter table public.payments
  add column if not exists addons_granted_at timestamptz;

comment on column public.payments.addons_granted_at is
  'Set once the units on this row have been added to household_addons. The webhook must claim it conditionally (where addons_granted_at is null) before granting, exactly as push-notify claims child_events.';
