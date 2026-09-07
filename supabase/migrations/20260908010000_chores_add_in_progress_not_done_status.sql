-- Adds 'in_progress' and 'not_done' to the chore lifecycle, so a child can
-- report status before marking a task fully done, and a parent can see it
-- without either state implying a reward decision (only 'submitted' does).

alter table public.chores drop constraint if exists chores_status_check;
alter table public.chores add constraint chores_status_check
  check (status = any (array['open','submitted','approved','declined','cancelled','completed','in_progress','not_done']));
