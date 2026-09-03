-- Safe trigger wrapper for the Architecture v2 policy materialisation bridge.
create or replace function public.sync_v2_policy_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare cid uuid; r record;
begin
  if tg_table_name = 'policy_assignments' then
    if tg_op <> 'INSERT' and old.child_id is not null then perform public.resolve_v2_policy_for_child(old.child_id); end if;
    if tg_op <> 'DELETE' and new.child_id is not null then perform public.resolve_v2_policy_for_child(new.child_id); end if;
    if tg_op <> 'INSERT' and old.device_id is not null then
      select child_id into cid from public.devices where id = old.device_id;
      if cid is not null then perform public.resolve_v2_policy_for_child(cid); end if;
    end if;
    if tg_op <> 'DELETE' and new.device_id is not null then
      select child_id into cid from public.devices where id = new.device_id;
      if cid is not null then perform public.resolve_v2_policy_for_child(cid); end if;
    end if;
  elsif tg_table_name = 'policy_exceptions' then
    if tg_op <> 'INSERT' and old.child_id is not null then perform public.resolve_v2_policy_for_child(old.child_id); end if;
    if tg_op <> 'DELETE' and new.child_id is not null then perform public.resolve_v2_policy_for_child(new.child_id); end if;
    if (tg_op = 'INSERT' and new.child_id is null) or (tg_op = 'DELETE' and old.child_id is null)
       or (tg_op = 'UPDATE' and (old.child_id is null or new.child_id is null)) then
      for r in select id from public.children where household_id = coalesce(new.household_id, old.household_id) loop
        perform public.resolve_v2_policy_for_child(r.id);
      end loop;
    end if;
  elsif tg_table_name = 'policy_profiles' then
    for r in
      select distinct coalesce(pa.child_id, d.child_id) child_id
      from public.policy_assignments pa
      left join public.devices d on d.id = pa.device_id
      where pa.policy_profile_id = coalesce(new.id, old.id)
        and coalesce(pa.child_id, d.child_id) is not null
    loop perform public.resolve_v2_policy_for_child(r.child_id); end loop;
  elsif tg_table_name = 'devices' then
    if tg_op <> 'INSERT' and old.child_id is not null then perform public.resolve_v2_policy_for_child(old.child_id); end if;
    if tg_op <> 'DELETE' and new.child_id is not null then perform public.resolve_v2_policy_for_child(new.child_id); end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.sync_v2_policy_trigger() from public, anon, authenticated;

drop trigger if exists trg_v2_policy_assignment_resolve on public.policy_assignments;
create trigger trg_v2_policy_assignment_resolve after insert or update or delete on public.policy_assignments for each row execute function public.sync_v2_policy_trigger();
drop trigger if exists trg_v2_policy_exception_resolve on public.policy_exceptions;
create trigger trg_v2_policy_exception_resolve after insert or update or delete on public.policy_exceptions for each row execute function public.sync_v2_policy_trigger();
drop trigger if exists trg_v2_policy_profile_resolve on public.policy_profiles;
create trigger trg_v2_policy_profile_resolve after insert or update or delete on public.policy_profiles for each row execute function public.sync_v2_policy_trigger();
drop trigger if exists trg_v2_device_resolve on public.devices;
create trigger trg_v2_device_resolve after insert or update or delete on public.devices for each row execute function public.sync_v2_policy_trigger();
