-- Push notifications: what has already been buzzed, and how a phone claims its
-- FCM token.
--
-- Two problems, both of which only appear once a notification can actually be
-- sent.

-- ------------------------------------------------------------ notified_at
--
-- Events arrive more than once. The child device resends its log until the
-- server acknowledges it, and `child_events` is upserted with the duplicates
-- ignored — which is correct for storage and useless for deciding what to
-- notify, because the ingest path cannot tell a first arrival from the fourth
-- replay of the same row.
--
-- So the decision moves onto the row itself: null means "nobody has been told",
-- and the sender stamps it. That makes the push idempotent no matter how many
-- times, or by which route, the event reaches the server.

alter table public.child_events add column if not exists notified_at timestamptz;

-- Everything already stored predates push entirely. Left null, the first child
-- to sync after this deploys would hand its parent a notification for every
-- alert in its history.
update public.child_events set notified_at = received_at where notified_at is null;

-- Matches the sender's query exactly, and stays tiny: rows leave the index as
-- soon as they are stamped, and only these five kinds ever enter it.
create index if not exists child_events_push_pending
  on public.child_events (child_id, ts)
  where notified_at is null
    and kind in ('zone-enter', 'zone-leave', 'filter-off', 'contact-added', 'tamper');

-- ------------------------------------------------------- device token claim
--
-- A phone registering its FCM token cannot simply upsert it. The token is the
-- primary key and belongs to the *handset*, not the account, so when a second
-- parent signs in on a phone the first one used, the conflicting row is owned
-- by somebody else — and the UPDATE half of the upsert is refused by the very
-- policy that should refuse it. The parent silently gets no notifications, and
-- worse, the phone keeps buzzing for the previous owner's household.
--
-- Same shape as `redeem_household_invite`: the one write that legitimately has
-- to reach a row the caller does not yet own goes through a definer function
-- that does exactly that and nothing else.

create or replace function public.claim_device_token(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'A token is required.' using errcode = '22023';
  end if;

  insert into public.device_tokens (token, user_id, child_id, platform, updated_at)
  values (trim(p_token), auth.uid(), null, coalesce(nullif(trim(p_platform), ''), 'android'), now())
  on conflict (token) do update
    set user_id = auth.uid(),
        -- A token that used to be a child's is now this parent's. Clearing it
        -- keeps the device_tokens_owner check satisfiable.
        child_id = null,
        platform = excluded.platform,
        updated_at = now();
end;
$$;

revoke all on function public.claim_device_token(text, text) from public, anon;
grant execute on function public.claim_device_token(text, text) to authenticated;

-- The sender fans out by household member, so every send reads this by user.
create index if not exists device_tokens_user_id on public.device_tokens (user_id);
