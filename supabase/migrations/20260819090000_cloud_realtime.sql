-- Cloud-first synchronisation: publish the child-facing tables to Supabase Realtime.
--
-- The child app uploads directly to Supabase. The web portal and parent app
-- consume the same cloud state. Bluetooth remains an offline fallback only.
-- Realtime is additive; the parent app keeps its periodic pull as a recovery
-- path when a socket is unavailable.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.child_telemetry;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.child_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.child_usage;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.locate_requests;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.policies;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;
