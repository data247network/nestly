-- Device-registry helpers are trigger-only. They must not be callable through PostgREST RPC.
revoke execute on function public.sync_v2_child_device_registry(uuid) from public, anon, authenticated;
revoke execute on function public.sync_v2_child_device_registry_trigger() from public, anon, authenticated;
revoke execute on function public.sync_v2_telemetry_device_registry() from public, anon, authenticated;

alter function public.sync_v2_child_device_registry(uuid) set search_path = public;
alter function public.sync_v2_child_device_registry_trigger() set search_path = public;
alter function public.sync_v2_telemetry_device_registry() set search_path = public;