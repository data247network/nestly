-- Notes over the internet, with Bluetooth as the fallback.
--
-- `notes` has existed since the core schema and was never written to: notes
-- lived entirely on the two phones and crossed only over BLE, so a parent at
-- work could not leave one for a child at school — the single most obvious
-- thing to want from a family app with an internet connection.
--
-- Two columns make the same note safe to carry over *both* links at once.
--
-- `client_id` is the id the sending device mints, and it is the whole trick.
-- Events already de-duplicate on (child_id, seq) so that an event arriving over
-- the radio and over the wire collapses into one; notes had no such key, and a
-- server-generated uuid cannot be one — the phone that wrote the note has
-- already filed it under its own id and would not recognise the row as its own
-- coming back. Unique, so a replay is a no-op rather than a duplicate, which is
-- the normal case here: a device resends until it is acknowledged.
--
-- `ts` is the author's clock, distinct from `created_at`, which is when the
-- server heard about it. A note written offline and uploaded an hour later must
-- sort where it was written, or a thread reorders itself the moment a phone
-- comes back into signal.

alter table public.notes
  add column if not exists client_id text,
  add column if not exists ts timestamptz not null default now();

-- Empty in practice; this exists so the migration is safe on any copy that
-- is not.
update public.notes set client_id = id::text where client_id is null;

alter table public.notes alter column client_id set not null;

create unique index if not exists notes_client_id_key on public.notes (client_id);
create index if not exists notes_child_ts_idx on public.notes (child_id, ts desc);

-- Realtime is opt-in per table: a channel on an unpublished table looks
-- perfectly healthy and never fires. Without this a parent would see a note
-- only on the next poll, which for a message is long enough to notice.
do $$
begin
  alter publication supabase_realtime add table public.notes;
exception
  when duplicate_object then null;
end
$$;
