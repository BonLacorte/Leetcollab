-- Disposable migrated database only. Synthetic completions, no provider or Java.
\set ON_ERROR_STOP on
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); late uuid := gen_random_uuid();
  capped uuid := gen_random_uuid(); fresh uuid := gen_random_uuid(); identity uuid;
  problem uuid; key uuid := gen_random_uuid(); accepted_submit uuid; repeated_submit uuid;
  result jsonb; quota jsonb; attempt uuid; credits integer;
  starts timestamptz := '2196-01-01T23:55:00Z'; ends timestamptz := '2196-01-02T23:55:00Z';
begin
  foreach identity in array array[a,b,late,capped,fresh] loop
    insert into auth.users(id,email,raw_user_meta_data) values(identity,identity||'@example.test',
      jsonb_build_object('username','intent_'||left(identity::text,20)));
  end loop;
  select id into strict problem from public.problems where slug='parcel-pair';
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,null,
    a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where user_id=a)
    or exists(select 1 from public.judge_submission_participants where submission_id=attempt)
    or exists(select 1 from public.submissions where id=attempt and participants_captured_at is not null) then
    raise exception 'Accepted Run must not store a snapshot or grant solved credit';
  end if;
  begin
    perform public.reserve_judge_execution('user','onlinecompiler','submit',null,array[a],now(),
      a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
    raise exception 'A Run key was upgraded to Submit';
  exception when invalid_parameter_value then null; end;

  key := gen_random_uuid();
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b],now(),
    a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  accepted_submit := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,accepted_submit,'completed','accepted',3,3,1,'synthetic',null,null);
  select count(*) into credits from public.verified_problem_solves where submission_id=accepted_submit and user_id in(a,b);
  if credits<>2 or exists(select 1 from public.verified_problem_solves where user_id=late) then
    raise exception 'Only captured Submit participants receive shared credit';
  end if;
  quota := public.get_user_judge_quota_status(a,starts,ends,25);
  if (quota->>'used')::int<>2 then raise exception 'Actor must pay for Run and Submit'; end if;
  quota := public.get_user_judge_quota_status(b,starts,ends,25);
  if (quota->>'used')::int<>0 or exists(select 1 from public.submissions where user_id=b) then
    raise exception 'Peer credit must not spend allowance or forge peer submissions';
  end if;

  -- A later snapshot cannot grow an already captured recipient set on replay.
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b,late],now(),
    a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'existing' then raise exception 'Expected an idempotent existing submission'; end if;
  perform public.complete_judge_submission(a,accepted_submit,'completed','accepted',3,3,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where user_id=late) then
    raise exception 'Replay must not credit later joiners';
  end if;
  result := public.reserve_judge_execution('user','onlinecompiler','submit',null,null,null,
    a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'existing' or (result->>'used')::int<>2
    or (select execution_room_id from public.submissions where id=accepted_submit)<>'abcdefgh'
    or (select count(*) from public.judge_submission_participants where submission_id=accepted_submit)<>2 then
    raise exception 'Replay after leaving must retain the original snapshot without charging';
  end if;
  begin
    perform public.reserve_judge_execution('user','onlinecompiler','submit',null,array[a],now(),
      a,problem,key,'java','class Solution { /* changed */ }',starts,ends,25,4,45);
    raise exception 'Changed code must not reuse the execution key';
  exception when invalid_parameter_value then null; end;

  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,null,
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  perform public.complete_judge_submission(a,(result->>'submissionId')::uuid,'completed','accepted',3,3,1,'synthetic',null,null);
  if (select count(*) from public.verified_problem_solves where user_id=a)<>1 then
    raise exception 'Accepted Run must preserve prior Submit credit without creating another';
  end if;
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b,late],now(),
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,attempt,'completed','wrong_answer',2,3,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where submission_id=attempt) then
    raise exception 'Wrong answer must not grant credit';
  end if;
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b,late],now(),
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,attempt,'completed','accepted',0,0,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where submission_id=attempt) then
    raise exception 'Zero tests must not grant credit';
  end if;

  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b],now(),
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  repeated_submit := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,repeated_submit,'completed','accepted',3,3,1,'synthetic',null,null);

  key := gen_random_uuid();
  begin
    perform public.reserve_judge_execution('shared','onlinecompiler','submit','abcdefgh',array[capped,late],now(),
      capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
    raise exception 'Restricted evaluation must reject a peer snapshot';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.reserve_judge_execution('shared','onlinecompiler','submit',null,null,null,
      capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
    raise exception 'A new Submit must not reserve without a snapshot';
  exception when invalid_parameter_value then null; end;
  result := public.reserve_judge_execution('shared','onlinecompiler','submit',null,array[capped],now(),
    capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'reserved' then raise exception 'Shared Submit should reserve with a fresh snapshot'; end if;
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(capped,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  if not exists(select 1 from public.verified_problem_solves where user_id=capped and submission_id=attempt)
    or exists(select 1 from public.verified_problem_solves where user_id=late) then
    raise exception 'Restricted evaluation must grant credit only to the actor';
  end if;
  result := public.reserve_judge_execution('shared','onlinecompiler','submit',null,null,null,
    capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'existing' then raise exception 'Shared Submit should replay without a fresh snapshot'; end if;
  quota := public.get_user_judge_quota_status(capped,starts,ends,25);
  if (quota->>'used')::int<>1 or (quota->>'limit')::int<>25 then
    raise exception 'A shared reservation must charge its actor once toward normal usage';
  end if;
  for i in 2..25 loop
    result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,null,
      capped,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
    if result->>'result'<>'reserved' then raise exception 'Personal execution % should reserve',i; end if;
    perform public.complete_judge_submission(capped,(result->>'submissionId')::uuid,'completed','accepted',3,3,1,'synthetic',null,null);
  end loop;
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,null,
    capped,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'exhausted' or (result->>'used')::int<>25 then
    raise exception 'Personal execution 26 must be refused';
  end if;
  -- Aggregate account usage is now greater than 25; a different user still has
  -- their own full allowance, while the global provider concurrency stays bound.
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,null,
    fresh,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,1,45);
  if result->>'result'<>'reserved' or (result->>'used')::int<>1 then
    raise exception 'One user must not spend another user allowance';
  end if;
  attempt := (result->>'submissionId')::uuid;
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,null,
    b,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,1,45);
  if result->>'result'<>'busy' or (result->>'used')::int<>0 then
    raise exception 'Global concurrency must refuse peers without charging them';
  end if;
  perform public.complete_judge_submission(fresh,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  perform public.exhaust_judge_quota(starts);
  quota := public.get_user_judge_quota_status(b,starts,ends,25);
  if quota->>'admission'<>'exhausted' or (quota->>'used')::int<>0 then
    raise exception 'Actual provider exhaustion must not spend personal peer usage';
  end if;

  if has_function_privilege('authenticated',
    'public.reserve_judge_execution(text,text,text,text,uuid[],timestamptz,uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer)','execute')
    or has_table_privilege('authenticated','public.verified_problem_solves','insert')
    or has_table_privilege('service_role','public.verified_problem_solves','insert') then
    raise exception 'Arbitrary recipient grants must not be exposed outside the completion function';
  end if;
  if has_any_column_privilege('authenticated','public.verified_problem_solves','select')
    or has_any_column_privilege('authenticated','public.judge_submission_participants','select')
    or has_function_privilege('authenticated','public.judge_refresh_recipients(uuid,uuid)','execute') then
    raise exception 'Client solved readback must omit private provenance and recipient rosters';
  end if;
  set local role service_role;
  select count(*) into credits from public.judge_refresh_recipients(accepted_submit,a) r where r.user_id in(a,b);
  if credits<>2 or exists(select 1 from public.judge_refresh_recipients(accepted_submit,a) r where r.user_id=late)
    or exists(select 1 from public.judge_refresh_recipients(accepted_submit,b))
    or exists(select 1 from public.judge_refresh_recipients(repeated_submit,a)) then
    raise exception 'Refresh must target captured first-time solvers for the original actor only';
  end if;
  reset role;
  perform set_config('request.jwt.claim.sub',b::text,true);
  set local role authenticated;
  if public.has_verified_problem_solve(problem) is distinct from true then
    raise exception 'A captured peer must be able to read their boolean solved state';
  end if;
  perform set_config('request.jwt.claim.sub',late::text,true);
  if public.has_verified_problem_solve(problem) is distinct from false then
    raise exception 'A late joiner must remain unsolved despite others receiving credit';
  end if;
  reset role;

  key := gen_random_uuid();
  result := public.reserve_onlinecompiler_submission(late,problem,key,'java','class Solution {}',
    starts+interval '10 days',ends+interval '10 days',20,4,45);
  attempt := (result->>'submissionId')::uuid;
  update public.submissions set execution_action='legacy' where id=attempt;
  perform public.complete_judge_submission(late,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,null,
    late,problem,key,'java','class Solution {}',starts+interval '11 days',ends+interval '11 days',25,4,45);
  if result->>'result'<>'existing' or (result->>'submissionId')::uuid<>attempt
    or (result->>'used')::int<>0 or (result->>'limit')::int<>25
    or exists(select 1 from public.judge_quota_periods where period_start=starts+interval '11 days')
    or exists(select 1 from public.judge_user_quota_periods where user_id=late and period_start=starts+interval '11 days')
    or not exists(select 1 from public.submissions where id=attempt and execution_action='legacy' and quota_scope='shared')
    or exists(select 1 from public.verified_problem_solves where submission_id=attempt) then
    raise exception 'A legacy retry must read the original outcome without changing state';
  end if;
  result := public.reserve_judge_execution('shared','onlinecompiler','run',null,null,null,
    late,problem,key,'java','class Solution {}',starts+interval '10 days',ends+interval '10 days',20,4,45);
  if result->>'result'<>'existing' or (result->>'used')::int<>1 then
    raise exception 'Evaluation retries must replay legacy attempts without charging';
  end if;
  begin
    perform public.reserve_judge_execution('user','onlinecompiler','submit',null,array[late],now(),
      late,problem,key,'java','class Solution {}',starts+interval '11 days',ends+interval '11 days',25,4,45);
    raise exception 'Legacy executions must not replay as Submit';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
