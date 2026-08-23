-- Keep claim_device_token available only to trusted server-side callers.
-- The production schema already applies this change; this migration records
-- the intended grant state in source control.
revoke execute on function public.claim_device_token(text, text) from authenticated;
