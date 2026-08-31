-- Nestly Architecture v2 foundation
-- Extends the existing cloud-first household model without replacing current tables.

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid references public.children(id) on delete set null, install_id text not null unique,
  platform text not null default 'android', display_name text,
  enrollment_state text not null default 'pending' check (enrollment_state in ('pending','active','revoked','retired')),
  management_mode text not null default 'standard' check (management_mode in ('standard','device_owner','managed')),
  last_seen_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists devices_household_idx on public.devices(household_id, child_id);

create table if not exists public.policy_profiles (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  name text not null, description text, priority integer not null default 100, body jsonb not null default '{}'::jsonb,
  active boolean not null default true, version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(household_id, name)
);
create table if not exists public.policy_assignments (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  policy_profile_id uuid not null references public.policy_profiles(id) on delete cascade,
  child_id uuid references public.children(id) on delete cascade, device_id uuid references public.devices(id) on delete cascade,
  starts_at timestamptz, ends_at timestamptz, active boolean not null default true, created_at timestamptz not null default now(),
  constraint policy_assignment_target check (child_id is not null or device_id is not null)
);
create table if not exists public.policy_exceptions (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid references public.children(id) on delete cascade,
  kind text not null check (kind in ('emergency_contact','emergency_app','temporary_unlock','approved_app')),
  value jsonb not null, priority integer not null default 1000, starts_at timestamptz, ends_at timestamptz,
  active boolean not null default true, created_at timestamptz not null default now()
);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid references public.children(id) on delete cascade, name text not null, timezone text not null default 'Europe/London',
  schedule jsonb not null, policy_profile_id uuid references public.policy_profiles(id) on delete set null,
  action jsonb not null default '{}'::jsonb, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.routine_runs (
  id uuid primary key default gen_random_uuid(), routine_id uuid not null references public.routines(id) on delete cascade,
  child_id uuid references public.children(id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled','dispatched','acknowledged','completed','failed','skipped')),
  scheduled_for timestamptz not null, executed_at timestamptz, result jsonb, created_at timestamptz not null default now()
);

create table if not exists public.safe_zones (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  name text not null, latitude double precision not null, longitude double precision not null,
  radius_m integer not null check (radius_m between 25 and 50000), active boolean not null default true,
  child_ids uuid[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.device_locations (
  child_id uuid primary key references public.children(id) on delete cascade, device_id uuid references public.devices(id) on delete set null,
  latitude double precision not null, longitude double precision not null, accuracy_m double precision, battery integer,
  recorded_at timestamptz not null, updated_at timestamptz not null default now()
);
create table if not exists public.location_events (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade, safe_zone_id uuid references public.safe_zones(id) on delete set null,
  event_type text not null check (event_type in ('entered','exited','missed_expected_arrival','location_unavailable')),
  occurred_at timestamptz not null default now(), metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.chores (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid references public.children(id) on delete cascade, title text not null, description text, due_at timestamptz,
  reward jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','submitted','approved','declined','cancelled','completed')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.chore_submissions (
  id uuid primary key default gen_random_uuid(), chore_id uuid not null references public.chores(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade, note text, submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz,
  status text not null default 'pending' check (status in ('pending','approved','declined'))
);
create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  name text not null, kind text not null check (kind in ('screen_time','points','custom')), value jsonb not null,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.reward_transactions (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade, reward_id uuid references public.rewards(id) on delete set null,
  source text not null check (source in ('chore','manual','request','system')),
  status text not null default 'pending' check (status in ('pending','approved','applied','reversed','expired')),
  payload jsonb not null default '{}'::jsonb, approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), applied_at timestamptz
);
create table if not exists public.child_requests (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade, device_id uuid references public.devices(id) on delete set null,
  kind text not null check (kind in ('extra_screen_time','app_access','temporary_unlock','routine_exception','custom')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','declined','expired','cancelled')),
  requested_at timestamptz not null default now(), resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz, resolution jsonb
);
create table if not exists public.command_delivery (
  id uuid primary key default gen_random_uuid(), command_id uuid not null references public.device_commands(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  channel text not null check (channel in ('realtime','push','poll','bluetooth')),
  status text not null default 'queued' check (status in ('queued','delivered','acknowledged','failed')),
  attempted_at timestamptz not null default now(), acknowledged_at timestamptz, detail jsonb not null default '{}'::jsonb
);
create table if not exists public.audit_logs (
  id bigserial primary key, household_id uuid references public.households(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null, child_id uuid references public.children(id) on delete set null,
  action text not null, entity_type text not null, entity_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, child_id uuid references public.children(id) on delete set null,
  consent_type text not null, version text not null, granted boolean not null, recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb, constraint consent_subject check (user_id is not null or child_id is not null)
);

alter table public.devices enable row level security; alter table public.policy_profiles enable row level security;
alter table public.policy_assignments enable row level security; alter table public.policy_exceptions enable row level security;
alter table public.routines enable row level security; alter table public.routine_runs enable row level security;
alter table public.safe_zones enable row level security; alter table public.device_locations enable row level security;
alter table public.location_events enable row level security; alter table public.chores enable row level security;
alter table public.chore_submissions enable row level security; alter table public.rewards enable row level security;
alter table public.reward_transactions enable row level security; alter table public.child_requests enable row level security;
alter table public.command_delivery enable row level security; alter table public.audit_logs enable row level security;
alter table public.consent_records enable row level security;

create or replace function public.set_v2_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function public.enable_v2_parent_access(tbl regclass) returns void language plpgsql security definer set search_path = public, private as $$
declare n text := tbl::text; begin
 execute format('drop policy if exists "v2 household members" on %s', n);
 execute format('create policy "v2 household members" on %s for all to authenticated using (private.is_household_member(household_id)) with check (private.is_household_member(household_id))', n);
end; $$;
select public.enable_v2_parent_access('public.devices'); select public.enable_v2_parent_access('public.policy_profiles');
select public.enable_v2_parent_access('public.policy_assignments'); select public.enable_v2_parent_access('public.policy_exceptions');
select public.enable_v2_parent_access('public.routines'); select public.enable_v2_parent_access('public.safe_zones');
select public.enable_v2_parent_access('public.location_events'); select public.enable_v2_parent_access('public.chores');
select public.enable_v2_parent_access('public.rewards'); select public.enable_v2_parent_access('public.reward_transactions');
select public.enable_v2_parent_access('public.child_requests'); select public.enable_v2_parent_access('public.audit_logs');
select public.enable_v2_parent_access('public.consent_records');
create policy "v2 routine runs household members" on public.routine_runs for select to authenticated using (exists (select 1 from public.routines r where r.id = routine_runs.routine_id and private.is_household_member(r.household_id)));
create policy "v2 chore submissions household members" on public.chore_submissions for all to authenticated using (exists (select 1 from public.chores c where c.id = chore_submissions.chore_id and private.is_household_member(c.household_id))) with check (exists (select 1 from public.chores c where c.id = chore_submissions.chore_id and private.is_household_member(c.household_id)));
create policy "v2 device locations household members" on public.device_locations for select to authenticated using (private.is_household_member(private.child_household(child_id)));
create policy "v2 command delivery household members" on public.command_delivery for select to authenticated using (exists (select 1 from public.device_commands dc where dc.id = command_delivery.command_id and private.is_household_member(private.child_household(dc.child_id))));

drop trigger if exists trg_devices_updated_at on public.devices; create trigger trg_devices_updated_at before update on public.devices for each row execute function public.set_v2_updated_at();
drop trigger if exists trg_policy_profiles_updated_at on public.policy_profiles; create trigger trg_policy_profiles_updated_at before update on public.policy_profiles for each row execute function public.set_v2_updated_at();
drop trigger if exists trg_routines_updated_at on public.routines; create trigger trg_routines_updated_at before update on public.routines for each row execute function public.set_v2_updated_at();
drop trigger if exists trg_safe_zones_updated_at on public.safe_zones; create trigger trg_safe_zones_updated_at before update on public.safe_zones for each row execute function public.set_v2_updated_at();
drop trigger if exists trg_chores_updated_at on public.chores; create trigger trg_chores_updated_at before update on public.chores for each row execute function public.set_v2_updated_at();

do $$ begin
 begin alter publication supabase_realtime add table public.child_requests; exception when duplicate_object then null; end;
 begin alter publication supabase_realtime add table public.reward_transactions; exception when duplicate_object then null; end;
 begin alter publication supabase_realtime add table public.device_locations; exception when duplicate_object then null; end;
end $$;