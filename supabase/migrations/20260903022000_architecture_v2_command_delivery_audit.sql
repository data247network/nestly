-- Materialise device command lifecycle into Architecture v2 delivery history.
create or replace function public.sync_v2_command_delivery()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare did uuid; ds text;
begin
  select id into did from public.devices where child_id=coalesce(new.child_id,old.child_id) and enrollment_state='active' order by updated_at desc limit 1;
  ds := case coalesce(new.status,old.status)
    when 'pending' then 'queued' when 'claimed' then 'delivered' when 'applied' then 'delivered'
    when 'completed' then 'acknowledged' when 'failed' then 'failed' when 'expired' then 'failed'
    else 'queued' end;
  if tg_op='INSERT' then
    insert into public.command_delivery(command_id,device_id,channel,status,attempted_at,acknowledged_at,detail)
    values(new.id,did,'poll',ds,coalesce(new.claimed_at,new.created_at),case when ds='acknowledged' then new.executed_at else null end,jsonb_build_object('source','device_commands'));
  else
    update public.command_delivery cd set device_id=coalesce(did,cd.device_id),status=ds,attempted_at=coalesce(new.claimed_at,cd.attempted_at),acknowledged_at=case when ds='acknowledged' then coalesce(new.executed_at,now()) else cd.acknowledged_at end,detail=coalesce(cd.detail,'{}'::jsonb)||jsonb_build_object('last_status',coalesce(new.status,old.status)) where cd.command_id=coalesce(new.id,old.id);
    if not found then insert into public.command_delivery(command_id,device_id,channel,status,attempted_at,acknowledged_at,detail) values(coalesce(new.id,old.id),did,'poll',ds,now(),case when ds='acknowledged' then now() else null end,jsonb_build_object('source','device_commands')); end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function public.sync_v2_command_delivery() from public,anon,authenticated;
drop trigger if exists trg_v2_command_delivery on public.device_commands;
create trigger trg_v2_command_delivery after insert or update on public.device_commands for each row execute function public.sync_v2_command_delivery();
