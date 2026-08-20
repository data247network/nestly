-- Cloud-first parent -> child command queue.
-- Supabase is the source of truth; Bluetooth remains an offline fallback.

CREATE TABLE IF NOT EXISTS public.device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  command text NOT NULL CHECK (command IN ('lock','unlock','locate','refresh')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','completed','failed','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  executed_at timestamptz,
  result jsonb
);

CREATE INDEX IF NOT EXISTS device_commands_child_pending_idx
  ON public.device_commands(child_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS device_commands_created_idx
  ON public.device_commands(created_at DESC);

ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parents read own child commands" ON public.device_commands;
DROP POLICY IF EXISTS "parents create own child commands" ON public.device_commands;

CREATE POLICY "parents read own child commands"
  ON public.device_commands
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children c
      JOIN public.household_members hm ON hm.household_id = c.household_id
      WHERE c.id = device_commands.child_id
        AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "parents create own child commands"
  ON public.device_commands
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.children c
      JOIN public.household_members hm ON hm.household_id = c.household_id
      WHERE c.id = device_commands.child_id
        AND hm.user_id = auth.uid()
    )
  );

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_commands;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;
