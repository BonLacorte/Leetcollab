-- Run only in a fresh disposable database after all migrations.
\set ON_ERROR_STOP on

select gen_random_uuid() as tester, gen_random_uuid() as partner,
  date_trunc('day', now() + interval '5 minutes') - interval '5 minutes' as period_start
\gset

insert into auth.users(id, email, raw_user_meta_data)
select id, id || '@example.test', jsonb_build_object('username', 'local_' || left(id::text, 20))
from unnest(array[:'tester'::uuid, :'partner'::uuid]) as ids(id);

insert into public.judge_quota_periods(period_start, period_end, quota_limit, used)
values (:'period_start', :'period_start'::timestamptz + interval '1 day', 20, 7);
insert into public.judge_user_quota_periods(user_id, period_start, period_end, quota_limit, used)
values (:'tester', :'period_start', :'period_start'::timestamptz + interval '1 day', 25, 7);

\ir ../local/enable-test-quota.sql

begin;
select set_config('test.quota_actor', :'tester', true),
       set_config('test.quota_partner', :'partner', true),
       set_config('test.quota_start', :'period_start', true);

do $$
declare
  tester uuid := current_setting('test.quota_actor')::uuid;
  partner uuid := current_setting('test.quota_partner')::uuid;
  problem uuid;
  test_start timestamptz := current_setting('test.quota_start')::timestamptz;
  test_end timestamptz := test_start + interval '1 day';
  response jsonb;
  key uuid;
  count integer;
begin
  select id into strict problem from public.problems where slug = 'parcel-pair';
  if not exists (select 1 from public.judge_quota_periods
    where period_start = test_start and used = 7 and quota_limit = 20 and active = 0) then
    raise exception 'Local opt-in changed the shared ledger or limit';
  end if;

  response := public.get_user_judge_quota_status(tester, test_start, test_end, 50);
  if (response->>'used')::integer <> 7 or (response->>'limit')::integer <> 50 then
    raise exception 'Expected personal limit of 50 with seven executions already charged, got %', response;
  end if;

  for count in 8..50 loop
    key := gen_random_uuid();
    response := public.reserve_judge_execution('user', 'onlinecompiler', 'run',null,null,
      tester, problem, key, 'java', 'class Solution {}', test_start, test_end, 50, 1, 45);
    if response->>'result' <> 'reserved' or (response->>'used')::integer <> count then
      raise exception 'Expected exactly one charge at execution %, got %', count, response;
    end if;
    perform public.complete_judge_submission(tester, (response->>'submissionId')::uuid,
      'failed', 'runtime_error', 0, 3, 0, 'Synthetic failed attempt remains charged', null, null);
  end loop;

  response := public.reserve_judge_execution('user', 'onlinecompiler', 'run',null,null,
    tester, problem, key, 'java', 'class Solution {}', test_start, test_end, 50, 1, 45);
  if response->>'result' <> 'existing' or (response->>'used')::integer <> 50 then
    raise exception 'Duplicate consumed another personal execution: %', response;
  end if;

  response := public.reserve_judge_execution('user', 'onlinecompiler', 'run',null,null,
    tester, problem, gen_random_uuid(), 'java', 'class Solution {}', test_start, test_end, 50, 1, 45);
  if response->>'result' <> 'exhausted' or (response->>'used')::integer <> 50 then
    raise exception 'The actor must be refused execution 51: %', response;
  end if;

  response := public.reserve_judge_execution('user', 'onlinecompiler', 'run',null,null,
    partner, problem, gen_random_uuid(), 'java', 'class Solution {}', test_start, test_end, 50, 1, 45);
  if response->>'result' <> 'reserved' or (response->>'used')::integer <> 1 then
    raise exception 'The partner still has a separate allowance: %', response;
  end if;

  response := public.reserve_judge_execution('user', 'onlinecompiler', 'run',null,null,
    tester, problem, gen_random_uuid(), 'java', 'class Solution {}', test_end, test_end+interval '1 day', 50, 1, 45);
  if response->>'result' <> 'reserved' or (response->>'limit')::integer <> 50
    or not exists(select 1 from public.judge_quota_periods where period_start=test_end and quota_limit=20 and used=1) then
    raise exception 'A fresh local period must seed separate personal and shared limits: %', response;
  end if;
end;
$$;

rollback;
