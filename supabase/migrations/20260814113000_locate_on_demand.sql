-- Asking a child's phone where it is, right now.
--
-- Telemetry is a heartbeat: every sixty seconds, and five minutes when the
-- battery is low. That is the right cadence for a background trickle and the
-- wrong one for the moment a parent actually taps Locate — they get a position
-- that may be five minutes and several streets old, with nothing on screen to
-- say so.
--
-- So the button becomes a request rather than a read. One row per child, not a
-- log: "where are you now" asked twice in a minute is the same question, and
-- queueing the second would have the phone take two fixes to answer it.
--
-- The answer is stored here as well as in `child_telemetry`, and that is
-- deliberate. Telemetry is last-write-wins, so the fix a parent asked for can
-- be overwritten by the routine push that lands a second later — and then the
-- screen showing "here is where they are now" is showing something else.

create table if not exists public.locate_requests (
  child_id uuid primary key references public.children (id) on delete cascade,
  requested_at timestamptz not null default now(),
  requested_by uuid references auth.users (id) on delete set null,
  -- Null while the phone has not answered. This is what the device polls on.
  served_at timestamptz,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  -- The device's own clock at the moment of the fix, so freshness can be shown
  -- honestly rather than assumed from when the row was written.
  fix_ts timestamptz
);

alter table public.locate_requests enable row level security;

-- The same boundary as every other table: a household, and nothing outside it.
drop policy if exists locate_requests_all on public.locate_requests;
create policy locate_requests_all on public.locate_requests
  for all
  using (private.is_household_member(private.child_household(child_id)))
  with check (private.is_household_member(private.child_household(child_id)));

-- The parent's screen waits on this. Without realtime it would have to poll,
-- and a spinner that updates every fifteen seconds makes a fix that arrived in
-- three feel like it took fifteen.
do $$
begin
  alter publication supabase_realtime add table public.locate_requests;
exception
  when duplicate_object then null;
end
$$;
