-- device_commands.command is constrained to a fixed set of values. The
-- constraint was not previously tracked in this migrations directory (it
-- exists live as `device_commands_command_check`, added outside a file this
-- repo has a record of) — recreated here so it stays in source control going
-- forward, widened to admit the new `apply_app_rules` command used to deliver
-- per-app caps/lock/PEGI to a child reached via the cloud queue rather than
-- Bluetooth.

alter table public.device_commands
  drop constraint if exists device_commands_command_check;

alter table public.device_commands
  add constraint device_commands_command_check
  check (command = any (array['lock'::text, 'unlock'::text, 'locate'::text, 'refresh'::text, 'apply_app_rules'::text]));
