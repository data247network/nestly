-- Architecture v2 authoritative policy resolution bridge.
-- Materialises the resolved v2 policy into the legacy policies table so the
-- existing child-sync transport receives exactly the policy defined by the
-- v2 profile/assignment/exception model.

create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := coalesce(a, '{}'::jsonb);
  k text;
  v jsonb;
begin
  if jsonb_typeof(coalesce(b, 'null'::jsonb)) <> 'object' then
    return coalesce(b, 'null'::jsonb);
  end if;
  for k, v in select key, value from jsonb_each(b) loop
    if jsonb_typeof(result -> k) = 'object' and jsonb_typeof(v) = 'object' then
      result := jsonb_set(result, array[k], public.jsonb_deep_merge(result -> k, v), true);
    else
      result := jsonb_set(result, array[k], v, true);
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.resolve_v2_policy_for_child(p_child_id uuid)
returns table(policy jsonb, policy_version integer)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  hid uuid;
  resolved jsonb := '{"locked":false}'::jsonb;
  next_version integer := 1;
  row_data record;
  current_body jsonb;
  current_version integer;
begin
  select household_id into hid from public.children where id = p_child_id;
  if hid is null then
    return;
  end if;

  -- Lower priority layers are merged first; higher priority values win.
  for row_data in
    select pp.body
    from public.policy_assignments pa
    join public.policy_profiles pp on pp.id = pa.policy_profile_id
    left join public.devices d on d.id = pa.device_id
    where pp.household_id = hid
      and pp.active = true
      and pa.active = true
      and (pa.child_id = p_child_id or d.child_id = p_child_id)
      and (pa.starts_at is null or pa.starts_at <= now())
      and (pa.ends_at is null or pa.ends_at > now())
    order by pp.priority asc, pp.updated_at asc, pp.id asc
  loop
    resolved := public.jsonb_deep_merge(resolved, coalesce(row_data.body, '{}'::jsonb));
  end loop;

  -- Exceptions deliberately form the final layer. Priority is ascending so
  -- the highest-priority exception is the final value when keys overlap.
  for row_data in
    select pe.value
    from public.policy_exceptions pe
    where pe.household_id = hid
      and (pe.child_id = p_child_id or pe.child_id is null)
      and pe.active = true
      and (pe.starts_at is null or pe.starts_at <= now())
      and (pe.ends_at is null or pe.ends_at > now())
    order by pe.priority asc, pe.created_at asc, pe.id asc
  loop
    resolved := public.jsonb_deep_merge(resolved, coalesce(row_data.value, '{}'::jsonb));
  end loop;

  select p.body, p.version into current_body, current_version
  from public.policies p
  where p.household_id = hid and p.child_id = p_child_id
  order by p.version desc
  limit 1;

  if current_body is not distinct from resolved then
    next_version := coalesce(current_version, 1);
  else
    next_version := coalesce(current_version, 0) + 1;
    insert into public.policies(household_id, child_id, version, body)
    values (hid, p_child_id, next_version, resolved);
  end if;

  return query select resolved, next_version;
end;
$$;

revoke all on function public.resolve_v2_policy_for_child(uuid) from public, anon, authenticated;
grant execute on function public.resolve_v2_policy_for_child(uuid) to service_role;
revoke all on function public.jsonb_deep_merge(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.sync_v2_policy_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  cid uuid;
  did uuid;
  r record;
begin
  if tg_table_name = 'policy_assignments' then
    for cid in select x from unnest(array_remove(array[old.child_id, new.child_id], null::uuid)) x loop
      perform public.resolve_v2_policy_for_child(cid);
    end loop;
    for did in select x from unnest(array_remove(array[old.device_id, new.device_id], null::uuid)) x loop
      select child_id into cid from public.devices where id = did;
      if cid is not null then perform public.resolve_v2_policy_for_child(cid); end if;
    end loop;
  elsif tg_table_name = 'policy_exceptions' then
    for cid in select x from unnest(array_remove(array[old.child_id, new.child_id], null::uuid)) x loop
      perform public.resolve_v2_policy_for_child(cid);
    end loop;
    if old.child_id is null or new.child_id is null then
      for r in select id from public.children where household_id = coalesce(new.household_id, old.household_id) loop
        perform public.resolve_v2_policy_for_child(r.id);
      end loop;
    end if;
  elsif tg_table_name = 'policy_profiles' then
    for r in
      select distinct coalesce(pa.child_id, d.child_id) as child_id
      from public.policy_assignments pa
      left join public.devices d on d.id = pa.device_id
      where pa.policy_profile_id = coalesce(new.id, old.id)
        and coalesce(pa.child_id, d.child_id) is not null
    loop
      perform public.resolve_v2_policy_for_child(r.child_id);
    end loop;
  elsif tg_table_name = 'devices' then
    if old.child_id is not null then perform public.resolve_v2_policy_for_child(old.child_id); end if;
    if new.child_id is not null then perform public.resolve_v2_policy_for_child(new.child_id); end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- Trigger functions are only used by PostgreSQL itself.
revoke all on function public.sync_v2_policy_trigger() from public, anon, authenticated;

drop trigger if exists trg_v2_policy_assignment_resolve on public.policy_assignments;
create trigger trg_v2_policy_assignment_resolve after insert or update or delete on public.policy_assignments
for each row execute function public.sync_v2_policy_trigger();

drop trigger if exists trg_v2_policy_exception_resolve on public.policy_exceptions;
create trigger trg_v2_policy_exception_resolve after insert or update or delete on public.policy_exceptions
for each row execute function public.sync_v2_policy_trigger();

drop trigger if exists trg_v2_policy_profile_resolve on public.policy_profiles;
create trigger trg_v2_policy_profile_resolve after insert or update or delete on public.policy_profiles
for each row execute function public.sync_v2_policy_trigger();

drop trigger if exists trg_v2_device_resolve on public.devices;
create trigger trg_v2_device_resolve after insert or update or delete on public.devices
for each row execute function public.sync_v2_policy_trigger();

-- Remove the known accidental authenticated execute grant on the child token RPC.
revoke execute on function public.claim_device_token(text, text) from authenticated;
revoke execute on function public.claim_device_token(text, text) from anon;
