-- Run only in a disposable database after all migrations and the local opt-in
-- script. Seed its current period with used=7, limit=20 before the opt-in script.
\set ON_ERROR_STOP on
begin;

do $$
declare
  tester uuid := gen_random_uuid();
  problem uuid;
  test_start timestamptz := date_trunc('day', now() + interval '5 minutes') - interval '5 minutes';
  test_end timestamptz := test_start + interval '1 day';
  response jsonb;
  attempt uuid;
  key uuid;
  count integer;
begin
  select id into strict problem from public.problems where slug = 'parcel-pair';
  if not exists (select 1 from public.judge_quota_periods q
    where q.period_start = test_start and q.used = 7 and q.quota_limit = 50 and q.active = 0) then
    raise exception 'Local opt-in must retain the seven previously charged executions';
  end if;

  if has_function_privilege('authenticated',
    'public.reserve_onlinecompiler_submission(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer)', 'execute')
    or has_function_privilege('service_role',
    'public.reserve_judge_submission_internal(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer)', 'execute') then
    raise exception 'Local opt-in must preserve reservation privileges';
  end if;

  insert into auth.users(id, email, raw_user_meta_data)
  values(tester, tester || '@example.test', jsonb_build_object('username', 'local_' || left(tester::text, 20)));

  for count in 8..50 loop
    key := gen_random_uuid();
    response := public.reserve_onlinecompiler_submission(tester, problem, key,
      'java', 'class Solution {}', test_start, test_end, 50, 1, 45);
    if response->>'result' <> 'reserved' or (response->>'used')::integer <> count then
      raise exception 'Expected exactly one charge at execution %, got %', count, response;
    end if;
    attempt := (response->>'submissionId')::uuid;
    perform public.complete_judge_submission(tester, attempt,
      'failed', 'runtime_error', 0, 3, 0, 'Synthetic failed attempt remains charged', null, null);
  end loop;

  response := public.reserve_onlinecompiler_submission(tester, problem, key,
    'java', 'class Solution {}', test_start, test_end, 50, 1, 45);
  if response->>'result' <> 'existing' or (response->>'used')::integer <> 50 then
    raise exception 'Duplicate must not create another charge';
  end if;
  response := public.reserve_onlinecompiler_submission(tester, problem, gen_random_uuid(),
    'java', 'class Solution {}', test_start, test_end, 50, 1, 45);
  if response->>'result' <> 'exhausted' or (response->>'used')::integer <> 50 then
    raise exception 'Execution 51 must be refused';
  end if;

  begin
    perform public.get_judge_quota_status(test_start, test_end, 51);
    raise exception 'Quota above 50 was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.reserve_onlinecompiler_submission(tester, problem, gen_random_uuid(),
      'java', 'class Solution {}', test_start, test_end, 51, 1, 45);
    raise exception 'Reservation above 50 was accepted';
  exception when invalid_parameter_value then null;
  end;

  -- Turning the local opt-in off preserves consumed usage, even above 20.
  response := public.get_judge_quota_status(test_start, test_end, 20);
  if (response->>'used')::integer <> 50 or (response->>'limit')::integer <> 20 then
    raise exception 'Rollback must retain usage';
  end if;
  response := public.get_judge_quota_status(test_start + interval '1 day', test_end + interval '1 day', 20);
  if (response->>'used')::integer <> 0 or (response->>'limit')::integer <> 20 then
    raise exception 'Normal callers must retain the 20-run default';
  end if;
end;
$$;

rollback;
