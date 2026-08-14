-- Notifications for notes.
--
-- Notes reach the server within seconds of being written, and then sat there:
-- a child writing "missed the bus" got nothing but a tick, and the parent found
-- out whenever they next happened to open Nestly. For a message that is not a
-- delay, it is a failure — the whole reason to type it was that somebody should
-- know now.
--
-- Same mechanism as `child_events.notified_at`, and for the same reason. The
-- device resends a note until it is acknowledged and the ingest path upserts
-- with duplicates ignored, so it cannot tell a first arrival from the fourth
-- replay. The decision moves onto the row: null means nobody has been told, and
-- the sender stamps it before sending. That is also what stops two concurrent
-- syncs buzzing twice.

alter table public.notes add column if not exists notified_at timestamptz;

-- Anything already stored predates this. Left null, the first sync after deploy
-- would notify a parent about every note in the thread's history.
update public.notes set notified_at = created_at where notified_at is null;

-- Matches the sender's query exactly, and stays tiny: a row leaves the index as
-- soon as it is stamped, and only a child's notes ever enter it. A parent's own
-- note is never pushed anywhere — the child's phone has no token registered,
-- deliberately, and telling a parent what they just typed is not a feature.
create index if not exists notes_push_pending
  on public.notes (child_id, ts)
  where notified_at is null and sender = 'child';
