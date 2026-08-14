-- The plan catalogue as it is actually sold, and per-unit extensions.
--
-- The catalogue had drifted into nonsense: the row with id `free` was named
-- "Standard" and priced at £4, the actual free tier lived under a second id
-- (`defaultfreeplan`) that nothing could be assigned to, and the Naira prices
-- bore no relation to the Sterling ones. Four rows, two of which lied about
-- what they were.
--
-- Prices come from the pricing sheet. Two decisions worth recording, because
-- neither is recoverable from the numbers alone:
--
--   * **Yearly is 15% off the year**, everywhere. The sheet had Standard at 15%
--     off twelve months (12,000 -> 10,200) but Pro and Premium at 15% off *one*
--     month (24,000 -> 23,700), which would have made the cheapest tier by far
--     the best value per adult. Read as written that is a discount of 1.25%
--     announced as 15%.
--
--   * **Sterling is derived from Naira at ₦1,842 to the pound.** That is the
--     sheet's own rate — 700/0.38 to the digit, and it reproduces 0.54, 1.09
--     and 1.63 exactly. Stored rather than computed at runtime so that a change
--     in the rate cannot silently reprice everybody mid-month.

-- ------------------------------------------------------------------ plans

-- `free` is the free tier again. It was the only id an existing household was
-- actually sitting on, so it is corrected in place rather than replaced.
update public.plans
   set name = 'Free Plan', max_parents = 1, max_children = 1,
       price_monthly = 0, price_annual = 0, currency = 'GBP', sort = 0,
       blurb = 'One adult, one child. Everything that works offline, free for ever.',
       active = true
 where id = 'free';

insert into public.plans (id, name, max_parents, max_children, price_monthly, price_annual, currency, blurb, active, sort)
values ('standard', 'Standard', 2, 2, 0.54, 5.54, 'GBP',
        'Two adults, two children.', true, 1)
on conflict (id) do update
   set name = excluded.name, max_parents = excluded.max_parents,
       max_children = excluded.max_children, price_monthly = excluded.price_monthly,
       price_annual = excluded.price_annual, currency = excluded.currency,
       blurb = excluded.blurb, active = excluded.active, sort = excluded.sort;

update public.plans
   set name = 'Pro', max_parents = 2, max_children = 4,
       price_monthly = 1.09, price_annual = 11.07, currency = 'GBP', sort = 2,
       blurb = 'Two adults, four children.', active = true
 where id = 'pro';

update public.plans
   set name = 'Premium', max_parents = 3, max_children = 6,
       price_monthly = 1.63, price_annual = 16.61, currency = 'GBP', sort = 3,
       blurb = 'Three adults, six children.', active = true
 where id = 'premium';

-- Nothing was ever on it — it could not be, which was the bug.
delete from public.plans where id = 'defaultfreeplan';

-- ------------------------------------------------------------ plan prices

insert into public.plan_prices (plan_id, currency, price_monthly, price_annual) values
  ('free',     'NGN',     0.00,     0.00),
  ('free',     'GBP',     0.00,     0.00),
  ('standard', 'NGN',  1000.00, 10200.00),
  ('standard', 'GBP',     0.54,     5.54),
  ('pro',      'NGN',  2000.00, 20400.00),
  ('pro',      'GBP',     1.09,    11.07),
  ('premium',  'NGN',  3000.00, 30600.00),
  ('premium',  'GBP',     1.63,    16.61)
on conflict (plan_id, currency) do update
   set price_monthly = excluded.price_monthly,
       price_annual = excluded.price_annual;

-- ----------------------------------------------------------------- add-ons
--
-- One extra adult or one extra child, on top of whatever plan the household is
-- on. Priced per unit rather than as another tier, because "I need one more
-- child slot" should not mean buying three.
--
-- A table rather than a constant for the same reason the plan catalogue is one:
-- an admin changing a price should not need a release on every phone.

create table if not exists public.addon_prices (
  currency text primary key,
  /** Per unit, per month. A unit is one extra adult or one extra child. */
  price_monthly numeric(12, 2) not null,
  /** Per unit, per year. Same 15%-off-the-year rule as the plans. */
  price_annual numeric(12, 2) not null,
  updated_at timestamptz not null default now()
);

insert into public.addon_prices (currency, price_monthly, price_annual) values
  ('NGN', 700.00, 7140.00),
  ('GBP',   0.38,    3.88)
on conflict (currency) do update
   set price_monthly = excluded.price_monthly,
       price_annual = excluded.price_annual,
       updated_at = now();

alter table public.addon_prices enable row level security;

-- Readable by anyone, like the plan catalogue: a price is not a secret, and the
-- upgrade screen has to show it before there is anything to authorise against.
drop policy if exists addon_prices_read on public.addon_prices;
create policy addon_prices_read on public.addon_prices for select using (true);

-- What a household has actually bought on top of its plan.
create table if not exists public.household_addons (
  household_id uuid primary key references public.households (id) on delete cascade,
  extra_adults integer not null default 0 check (extra_adults >= 0 and extra_adults <= 20),
  extra_children integer not null default 0 check (extra_children >= 0 and extra_children <= 20),
  updated_at timestamptz not null default now()
);

alter table public.household_addons enable row level security;

-- Readable by the household. **Not writable by it** — this is entitlement, and
-- entitlement a client can edit is not entitlement. It is written by the
-- payment webhooks under the service role, exactly like `subscriptions`.
drop policy if exists household_addons_read on public.household_addons;
create policy household_addons_read on public.household_addons
  for select using (private.is_household_member(household_id));

-- --------------------------------------------------------- effective limits
--
-- What this household may actually have, plan plus anything bought on top.
-- A function rather than arithmetic repeated in the app, the portal and the
-- edge functions — three copies of a capacity check is three chances to let
-- somebody past it.

create or replace function public.household_limits(p_household_id uuid)
returns table (max_adults integer, max_children integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(p.max_parents, 1) + coalesce(a.extra_adults, 0),
    coalesce(p.max_children, 1) + coalesce(a.extra_children, 0)
  from public.households h
  left join public.plans p on p.id = h.plan
  left join public.household_addons a on a.household_id = h.id
  where h.id = p_household_id;
$$;

revoke all on function public.household_limits(uuid) from public, anon;
grant execute on function public.household_limits(uuid) to authenticated;
