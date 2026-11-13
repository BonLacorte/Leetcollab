revoke all on table public.external_attempts from public, anon, authenticated, service_role;
revoke all on function public.record_external_attempt(uuid, text) from public, anon, authenticated, service_role;
