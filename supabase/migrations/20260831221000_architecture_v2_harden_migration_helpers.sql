-- Architecture v2 helper hardening.
alter function public.set_v2_updated_at() set search_path = public;
revoke all on function public.enable_v2_parent_access(regclass) from public, anon, authenticated;
-- enable_v2_parent_access is a migration-only SECURITY DEFINER helper.