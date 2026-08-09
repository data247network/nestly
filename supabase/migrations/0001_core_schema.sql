-- Nestly core schema
--
-- Shape follows the device protocol in src/link/protocol.ts, so the same
-- Policy document the child already enforces over Bluetooth is what the server
-- stores. That is deliberate: the online service must not invent a second,
-- subtly different model of the rules, or the two will drift and a child will
-- end up enforcing something the parent never set.
--
-- Everything hangs off `household`. A household is the billing unit, the
-- sharing unit and the security boundary — every RLS policy in 0002 reduces to
-- "is the caller a member of this household?".

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- households

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My family',
  -- 'free' | 'pro' | 'premium'. Mirrors src/app/plans.ts.
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium')),
  -- Set from a verified Play purchase, never by the client.
  plan_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Adults. One row per parent device owner; `auth.users` holds the credentials.
create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'parent' check (role in ('owner', 'parent')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index on public.household_members (user_id);

-- ------------------------------------------------------------------ children

create table public.children (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  avatar text not null default '#147D77',
  -- The BLE address is deliberately NOT the key. Android rotates it for
  -- privacy, which is exactly the bug that broke reconnection on device.
  ble_address text,
  -- Stable per-install id the child device reports in `Hello`.
  device_id text,
  created_at timestamptz not null default now()
);

create index on public.children (household_id);

-- ------------------------------------------------------------------- policy
-- Stored as one versioned JSONB document rather than shredded into columns.
-- The child adopts a policy only if its version is >= its own, so the version
-- is the important part; the body is opaque to the server and validated
-- against the shared TypeScript types at the edge.

create table public.policies (
  household_id uuid not null references public.households (id) on delete cascade,
  -- Null means "applies to every child in the household", matching the
  -- empty-childIds convention used for zones in the app.
  child_id uuid references public.children (id) on delete cascade,
  version integer not null,
  body jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, child_id, version)
);

create index on public.policies (household_id, child_id, version desc);

-- ------------------------------------------------------------------- events
-- The child's append-only log. `seq` is per child and starts at 1 on every
-- install, so it is unique only *within* a child — never globally.

create table public.child_events (
  id bigserial primary key,
  child_id uuid not null references public.children (id) on delete cascade,
  seq integer not null,
  ts timestamptz not null,
  kind text not null,
  ref text,
  cat text,
  lat double precision,
  lng double precision,
  received_at timestamptz not null default now(),
  -- Replays are normal: the device resends until acked. Idempotent ingest.
  unique (child_id, seq)
);

create index on public.child_events (child_id, ts desc);

-- --------------------------------------------------------------- telemetry
-- Latest-only. History lives in child_events; this is "where are they now".

create table public.child_telemetry (
  child_id uuid primary key references public.children (id) on delete cascade,
  ts timestamptz not null,
  battery integer,
  charging boolean,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  active_scenario_id text,
  locked boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- usage
-- Replaceable daily snapshot, not history — resending today's totals is
-- correct, whereas resending an arrival event is not.

create table public.child_usage (
  child_id uuid not null references public.children (id) on delete cascade,
  day date not null,
  apps jsonb not null default '[]'::jsonb,
  sites jsonb not null default '[]'::jsonb,
  usage_access boolean not null default false,
  filter_on boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (child_id, day)
);

-- ------------------------------------------------------------------- notes

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  -- 'parent' | 'child'
  sender text not null check (sender in ('parent', 'child')),
  -- Set for parent-sent notes so a second adult can be told who wrote it.
  sender_user_id uuid references auth.users (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index on public.notes (child_id, created_at desc);

-- ------------------------------------------------------------ device tokens
-- FCM registration tokens, so an alert can reach a parent immediately rather
-- than waiting for the phones to be near each other.

create table public.device_tokens (
  token text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  child_id uuid references public.children (id) on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),
  -- A token belongs to a parent *or* a child device, never both.
  constraint device_tokens_owner check (
    (user_id is not null and child_id is null)
    or (user_id is null and child_id is not null)
  )
);

-- --------------------------------------------------------------- entitlements
-- Written only by the server after validating a Play receipt. Never by a
-- client: entitlement that the phone can edit is not entitlement.

create table public.subscriptions (
  household_id uuid primary key references public.households (id) on delete cascade,
  provider text not null default 'google_play',
  purchase_token text,
  product_id text,
  plan text not null check (plan in ('free', 'pro', 'premium')),
  status text not null default 'active',
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
