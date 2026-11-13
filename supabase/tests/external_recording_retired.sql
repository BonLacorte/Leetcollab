\set ON_ERROR_STOP on
begin;
insert into auth.users(id, email, raw_user_meta_data)
values ('feed0003-0000-4000-8000-000000000004', 'retirement@example.test', '{"username":"retirement_fixture"}');
insert into public.external_attempts(user_id, problem_id, outcome)
select 'feed0003-0000-4000-8000-000000000004', id, 'accepted'
from public.problems where slug = 'parcel-pair';
create temporary table preserved_external_attempts as table public.external_attempts;
\ir ../migrations/202611130004_retire_external_recording.sql

do $$
begin
  if exists (table preserved_external_attempts except table public.external_attempts)
    or exists (table public.external_attempts except table preserved_external_attempts) then
    raise exception 'retiring external recording must preserve existing rows';
  end if;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform public.record_external_attempt(gen_random_uuid(), 'accepted');
    raise exception 'retired recording RPC remains accessible';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.external_attempts;
    raise exception 'retired history remains accessible';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.record_external_attempt(gen_random_uuid(), 'accepted');
    raise exception 'anonymous recording remains accessible';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role service_role;
do $$
begin
  begin
    perform public.record_external_attempt(gen_random_uuid(), 'accepted');
    raise exception 'service recording remains accessible';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.external_attempts;
    raise exception 'service history remains accessible';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
