\set ON_ERROR_STOP on
-- Run only after all migrations against an owned disposable database.
-- Synthetic records and quota periods are rolled back, never hosted fixtures.
begin;

insert into auth.users(id, email, raw_user_meta_data) values
('feed0019-0000-4000-8000-000000000001', 'oc-reservation@example.test', '{}'),
('feed0019-0000-4000-8000-000000000002', 'oc-other-reader@example.test', '{}');

do $$
declare
  owner_id uuid := 'feed0019-0000-4000-8000-000000000001';
  problem uuid := (select id from public.problems where slug = 'parcel-pair');
  oc_key uuid := gen_random_uuid();
  jdoodle_key uuid := gen_random_uuid();
  first_result jsonb;
  replay jsonb;
  oc_id uuid;
  jdoodle_id uuid;
begin
  if problem is null then raise exception 'curated fixture is required'; end if;

  first_result := public.reserve_onlinecompiler_submission(owner_id, problem, oc_key,
    'java', 'class Solution {}', '2192-01-01', '2192-01-02', 20, 4, 45);
  oc_id := (first_result->>'submissionId')::uuid;
  if first_result->>'result' <> 'reserved' or (first_result->>'used')::integer <> 1
    or (select runner from public.submissions where id = oc_id) <> 'onlinecompiler' then
    raise exception 'new OnlineCompiler reservation must bind runner and consume quota once';
  end if;

  replay := public.reserve_onlinecompiler_submission(owner_id, problem, oc_key,
    'java', 'class Solution {}', '2192-01-01', '2192-01-02', 20, 4, 45);
  if replay->>'result' <> 'in_progress' or (replay->>'submissionId')::uuid <> oc_id
    or (replay->>'used')::integer <> 1 then
    raise exception 'in-progress replay must not create or spend a second attempt';
  end if;

  begin
    perform public.reserve_judge_submission(owner_id, problem, oc_key,
      'java', 'class Solution {}', '2192-01-01', '2192-01-02', 20, 4, 45);
    raise exception 'JDoodle must not replay an OnlineCompiler key';
  exception when invalid_parameter_value then null;
  end;

  perform public.complete_judge_submission(owner_id, oc_id, 'completed', 'wrong_answer',
    0, 3, 1, 'synthetic wrong answer', null, null);
  replay := public.reserve_onlinecompiler_submission(owner_id, problem, oc_key,
    'java', 'class Solution {}', '2192-01-01', '2192-01-02', 20, 4, 45);
  if replay->>'result' <> 'existing' or (replay->>'submissionId')::uuid <> oc_id
    or (replay->>'used')::integer <> 1 or (replay->>'active')::integer <> 0 then
    raise exception 'completed replay must retain usage and persisted attempt identity';
  end if;
  if exists (select 1 from public.user_problem_progress
    where user_id = owner_id and problem_id = problem and solved_at is not null) then
    raise exception 'wrong answer must not grant completion';
  end if;

  first_result := public.reserve_judge_submission(owner_id, problem, jdoodle_key,
    'java', 'class Solution {}', '2192-01-01', '2192-01-02', 20, 4, 45);
  jdoodle_id := (first_result->>'submissionId')::uuid;
  begin
    perform public.reserve_onlinecompiler_submission(owner_id, problem, jdoodle_key,
      'java', 'class Solution {}', '2192-01-01', '2192-01-02', 20, 4, 45);
    raise exception 'OnlineCompiler must not relabel a JDoodle key';
  exception when invalid_parameter_value then null;
  end;
  if (select runner from public.submissions where id = jdoodle_id) <> 'jdoodle'
    or (select runner from public.submissions where id = oc_id) <> 'onlinecompiler'
    or (select used from public.judge_quota_periods where period_start = '2192-01-01') <> 2 then
    raise exception 'runner refusal must preserve both provenance and usage';
  end if;

  replay := public.reserve_onlinecompiler_submission(owner_id, problem, gen_random_uuid(),
    'java', 'class Solution {}', '2192-01-01', '2192-01-02', 2, 4, 45);
  if replay->>'result' <> 'exhausted' or (replay->>'used')::integer <> 2
    or (select count(*) from public.submissions where user_id = owner_id) <> 2 then
    raise exception 'shared conservative cap must reject without creating another row';
  end if;
end;
$$;

do $$
declare
  internal_signature text := 'public.reserve_judge_submission_internal(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer)';
  helper_signature text := 'public.reserve_judge_submission_for_runner(text,uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer)';
  onlinecompiler_signature text := 'public.reserve_onlinecompiler_submission(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer)';
  checked_role text;
begin
  foreach checked_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(checked_role, internal_signature, 'EXECUTE')
      or has_function_privilege(checked_role, helper_signature, 'EXECUTE') then
      raise exception 'internal runner authority exposed to %', checked_role;
    end if;
  end loop;
  if has_function_privilege('anon', onlinecompiler_signature, 'EXECUTE')
    or has_function_privilege('authenticated', onlinecompiler_signature, 'EXECUTE')
    or not has_function_privilege('service_role', onlinecompiler_signature, 'EXECUTE') then
    raise exception 'OnlineCompiler RPC must be callable only by the trusted service role';
  end if;
end;
$$;

-- These are synthetic broker completions, not Java execution or live verdicts.
-- Keep the outcome checks in a separate period from the lowered-cap test above.
create temporary table onlinecompiler_result_ids (accepted_id uuid, compile_id uuid);
grant select on onlinecompiler_result_ids to authenticated;

do $$
declare
  owner_id uuid := 'feed0019-0000-4000-8000-000000000001';
  problem uuid := (select id from public.problems where slug = 'parcel-pair');
  reserved jsonb;
  completed jsonb;
  accepted_id uuid;
  compile_id uuid;
begin
  reserved := public.reserve_onlinecompiler_submission(owner_id, problem, gen_random_uuid(),
    'java', 'class Solution {}', '2192-02-01', '2192-02-02', 20, 4, 45);
  accepted_id := (reserved->>'submissionId')::uuid;
  completed := public.complete_judge_submission(owner_id, accepted_id, 'completed', 'accepted',
    3, 3, 1, 'synthetic fixture match', null, null);
  if completed->>'result' <> 'completed' or (completed->>'used')::integer <> 1
    or (completed->>'active')::integer <> 0 or not exists (
      select 1 from public.submissions where id = accepted_id and user_id = owner_id
        and runner = 'onlinecompiler' and judge_state = 'completed' and verdict = 'accepted'
        and verification = 'leetcollab' and tests_passed = 3 and tests_total = 3
    ) then
    raise exception 'accepted result must retain positive verified checks and runner provenance';
  end if;

  reserved := public.reserve_onlinecompiler_submission(owner_id, problem, gen_random_uuid(),
    'java', 'class Solution { invalid }', '2192-02-01', '2192-02-02', 20, 4, 45);
  compile_id := (reserved->>'submissionId')::uuid;
  completed := public.complete_judge_submission(owner_id, compile_id, 'completed', 'compile_error',
    0, 3, 1, 'synthetic compiler error', null, null);
  if completed->>'result' <> 'completed' or (completed->>'used')::integer <> 2
    or (completed->>'active')::integer <> 0 or not exists (
      select 1 from public.submissions where id = compile_id and user_id = owner_id
        and runner = 'onlinecompiler' and judge_state = 'completed' and verdict = 'compile_error'
        and status = 'error' and tests_passed = 0 and tests_total = 3
    ) then
    raise exception 'compile failure must persist without accepted or positive passing checks';
  end if;
  if exists (select 1 from public.user_problem_progress
    where user_id = owner_id and problem_id = problem and solved_at is not null) then
    raise exception 'recording results alone must not directly grant a solved transition';
  end if;
  insert into onlinecompiler_result_ids values (accepted_id, compile_id);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'feed0019-0000-4000-8000-000000000001', true);
do $$
begin
  if (select count(*) from public.submissions where id in (
      select accepted_id from onlinecompiler_result_ids
      union all select compile_id from onlinecompiler_result_ids)) <> 2 then
    raise exception 'authenticated owner must read both persisted results';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', 'feed0019-0000-4000-8000-000000000002', true);
do $$
begin
  if exists (select 1 from public.submissions where id in (
      select accepted_id from onlinecompiler_result_ids
      union all select compile_id from onlinecompiler_result_ids)) then
    raise exception 'another authenticated user must not read private execution results';
  end if;
end;
$$;
reset role;

rollback;
