-- Keep Architecture v2 devices aligned with the existing child enrolment/telemetry model.
-- Enrolled children were uploading to child_telemetry, but public.devices remained empty.

create or replace function public.sync_v2_child_device_registry(p_child_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  child_row record;
  device_uuid uuid;
begin
  select id, household_id, device_id, name into child_row
    from public.children where id = p_child_id;

  if child_row.id is null or child_row.device_id is null or btrim(child_row.device_id) = '' then
    return null;
  end if;

  insert into public.devices (
    household_id, child_id, install_id, platform, display_name,
    enrollment_state, management_mode, last_seen_at
  )
  values (
    child_row.household_id,
    child_row.id,
    child_row.device_id,
    'android',
    coalesce(nullif(btrim(child_row.name), ''), 'Child') || '''s phone',
    'active',
    'standard',
    now()
  )
  on conflict (install_id) do update
    set household_id = excluded.household_id,
        child_id = excluded.child_id,
        display_name = coalesce(excluded.display_name, public.devices.display_name),
        enrollment_state = case
          when public.devices.enrollment_state in ('revoked', 'retired') then 'active'
          else public.devices.enrollment_state
        end,
        last_seen_at = now();

  select id into device_uuid from public.devices where install_id = child_row.device_id;

  update public.devices
     set enrollment_state = 'retired'
   where child_id = child_row.id
     and id <> device_uuid
     and enrollment_state = 'active';

  return device_uuid;
end;
$$;

create or replace function public.sync_v2_child_device_registry_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_v2_child_device_registry(new.id);
  return new;
end;
$$;

revoke all on function public.sync_v2_child_device_registry(uuid) from public;
revoke all on function public.sync_v2_child_device_registry_trigger() from public;

drop trigger if exists trg_children_sync_v2_device on public.children;
create trigger trg_children_sync_v2_device
after insert or update of device_id on public.children
for each row execute function public.sync_v2_child_device_registry_trigger();

create or replace function public.sync_v2_telemetry_device_registry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  device_uuid uuid;
begin
  device_uuid := public.sync_v2_child_device_registry(new.child_id);

  if device_uuid is not null and new.lat is not null and new.lng is not null then
    insert into public.device_locations (
      child_id, device_id, latitude, longitude, accuracy_m, battery, recorded_at, updated_at
    )
    values (
      new.child_id, device_uuid, new.lat, new.lng, new.accuracy_m, new.battery, new.ts, now()
    )
    on conflict (child_id) do update
      set device_id = excluded.device_id,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          accuracy_m = excluded.accuracy_m,
          battery = excluded.battery,
          recorded_at = excluded.recorded_at,
          updated_at = now();
  end if;

  update public.devices
     set last_seen_at = coalesce(new.updated_at, now())
   where id = device_uuid and enrollment_state <> 'revoked';

  return new;
end;
$$;

revoke all on function public.sync_v2_telemetry_device_registry() from public;

drop trigger if exists trg_child_telemetry_sync_v2_device on public.child_telemetry;
create trigger trg_child_telemetry_sync_v2_device
after insert or update on public.child_telemetry
for each row execute function public.sync_v2_telemetry_device_registry();

-- Backfill existing enrolled children immediately.
do $$
declare r record;
begin
  for r in select id from public.children where device_id is not null and btrim(device_id) <> '' loop
    perform public.sync_v2_child_device_registry(r.id);
  end loop;

  insert into public.device_locations (
    child_id, device_id, latitude, longitude, accuracy_m, battery, recorded_at, updated_at
  )
  select t.child_id, d.id, t.lat, t.lng, t.accuracy_m, t.battery, t.ts, now()
    from public.child_telemetry t
    join public.devices d on d.child_id = t.child_id
   where t.lat is not null and t.lng is not null
  on conflict (child_id) do update
    set device_id = excluded.device_id,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        accuracy_m = excluded.accuracy_m,
        battery = excluded.battery,
        recorded_at = excluded.recorded_at,
        updated_at = now();

  update public.devices d
     set last_seen_at = t.updated_at
    from public.child_telemetry t
   where t.child_id = d.child_id;
end $$;