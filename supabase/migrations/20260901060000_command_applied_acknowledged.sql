-- Separate successful enforcement from final acknowledgement so parents can
-- distinguish "the child applied the policy" from "the server recorded it".
ALTER TABLE public.device_commands
  DROP CONSTRAINT IF EXISTS device_commands_status_check;

ALTER TABLE public.device_commands
  ADD CONSTRAINT device_commands_status_check
  CHECK (status IN ('pending','claimed','applied','completed','failed','expired'));

ALTER TABLE public.device_commands
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

CREATE INDEX IF NOT EXISTS device_commands_child_status_idx
  ON public.device_commands(child_id, status, created_at DESC);
