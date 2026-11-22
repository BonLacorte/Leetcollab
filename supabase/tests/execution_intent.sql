-- Disposable migrated database only. Synthetic completions, no provider or Java.
\set ON_ERROR_STOP on
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); late uuid := gen_random_uuid();
  capped uuid := gen_random_uuid(); fresh uuid := gen_random_uuid(); identity uuid;
  deleted_peer uuid := gen_random_uuid();
  problem uuid; key uuid := gen_random_uuid(); accepted_submit uuid; repeated_submit uuid;
  result jsonb; quota jsonb; attempt uuid; credits integer; draft_saved_at timestamptz;
  starts timestamptz := '2196-01-01T23:55:00Z'; ends timestamptz := '2196-01-02T23:55:00Z';
begin
  foreach identity in array array[a,b,late,capped,fresh] loop
    insert into auth.users(id,email,raw_user_meta_data) values(identity,identity||'@example.test',
      jsonb_build_object('username','intent_'||left(identity::text,20)));
  end loop;
  select id into strict problem from public.problems where slug='parcel-pair';
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
    a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where user_id=a)
    or exists(select 1 from public.judge_submission_participants where submission_id=attempt) then
    raise exception 'Accepted Run must not store a snapshot or grant solved credit';
  end if;
  begin
    perform public.reserve_judge_execution('user','onlinecompiler','submit',null,array[a],
      a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
    raise exception 'A Run key was upgraded to Submit';
  exception when invalid_parameter_value then null; end;

  key := gen_random_uuid();
  insert into auth.users(id,email) values(deleted_peer,'deleted-peer@example.test');
  delete from auth.users where id=deleted_peer;
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b,deleted_peer],
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
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b,late],
    a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'existing' then raise exception 'Expected an idempotent existing submission'; end if;
  perform public.complete_judge_submission(a,accepted_submit,'completed','accepted',3,3,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where user_id=late) then
    raise exception 'Replay must not credit later joiners';
  end if;
  result := public.reserve_judge_execution('user','onlinecompiler','submit',null,null,
    a,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'existing' or (result->>'used')::int<>2
    or exists(select 1 from public.judge_submission_participants where submission_id=accepted_submit and room_id is distinct from 'abcdefgh')
    or (select count(*) from public.judge_submission_participants where submission_id=accepted_submit)<>2 then
    raise exception 'Replay after leaving must retain the original snapshot without charging';
  end if;
  begin
    perform public.reserve_judge_execution('user','onlinecompiler','submit',null,array[a],
      a,problem,key,'java','class Solution { /* changed */ }',starts,ends,25,4,45);
    raise exception 'Changed code must not reuse the execution key';
  exception when invalid_parameter_value then null; end;

  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  perform public.complete_judge_submission(a,(result->>'submissionId')::uuid,'completed','accepted',3,3,1,'synthetic',null,null);
  if (select count(*) from public.verified_problem_solves where user_id=a)<>1 then
    raise exception 'Accepted Run must preserve prior Submit credit without creating another';
  end if;
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b,late],
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,attempt,'completed','wrong_answer',2,3,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where submission_id=attempt) then
    raise exception 'Wrong answer must not grant credit';
  end if;
  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b,late],
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,attempt,'completed','accepted',0,0,1,'synthetic',null,null);
  if exists(select 1 from public.verified_problem_solves where submission_id=attempt) then
    raise exception 'Zero tests must not grant credit';
  end if;

  result := public.reserve_judge_execution('user','onlinecompiler','submit','abcdefgh',array[a,b],
    a,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  repeated_submit := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(a,repeated_submit,'completed','accepted',3,3,1,'synthetic',null,null);

  if (select count(*) from public.verified_problem_solves where problem_id=problem and user_id in(a,b))<>2 then
    raise exception 'Repeating an accepted Submit must preserve the original solve for both recipients';
  end if;

  key := gen_random_uuid();
  begin
    perform public.reserve_judge_execution('shared','onlinecompiler','submit','abcdefgh',array[capped,late],
      capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
    raise exception 'Restricted evaluation must reject a peer snapshot';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.reserve_judge_execution('shared','onlinecompiler','submit',null,null,
      capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
    raise exception 'A new Submit must not reserve without a snapshot';
  exception when invalid_parameter_value then null; end;
  result := public.reserve_judge_execution('shared','onlinecompiler','submit',null,array[capped],
    capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'reserved' then raise exception 'Shared Submit should reserve with a fresh snapshot'; end if;
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(capped,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  if not exists(select 1 from public.verified_problem_solves where user_id=capped and submission_id=attempt)
    or exists(select 1 from public.verified_problem_solves where user_id=late) then
    raise exception 'Restricted evaluation must grant credit only to the actor';
  end if;
  result := public.reserve_judge_execution('shared','onlinecompiler','submit',null,null,
    capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'existing' then raise exception 'Shared Submit should replay without a fresh snapshot'; end if;
  quota := public.get_user_judge_quota_status(capped,starts,ends,25);
  if (quota->>'used')::int<>1 or (quota->>'limit')::int<>25 then
    raise exception 'A shared reservation must charge its actor once toward normal usage';
  end if;
  key := gen_random_uuid();
  result := public.reserve_judge_submission(capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'reserved' then raise exception 'Legacy JDoodle should still reserve'; end if;
  attempt := (result->>'submissionId')::uuid;
  result := public.reserve_judge_execution('user','jdoodle','run',null,null,
    capped,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'in_progress' or (result->>'submissionId')::uuid<>attempt then
    raise exception 'Redeploy must recognize a rollback reservation still in flight';
  end if;
  perform public.complete_judge_submission(capped,(result->>'submissionId')::uuid,'failed','runtime_error',0,0,1,'synthetic',null,null);
  result := public.reserve_judge_submission(capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'existing' then raise exception 'Legacy JDoodle should still replay'; end if;
  result := public.reserve_judge_execution('user','jdoodle','run',null,null,
    capped,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'existing' or (result->>'submissionId')::uuid<>attempt then
    raise exception 'Redeploy must replay the original JDoodle rollback reservation';
  end if;

  key := gen_random_uuid();
  result := public.reserve_onlinecompiler_submission(capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'reserved' then raise exception 'Legacy OnlineCompiler should still reserve'; end if;
  attempt := (result->>'submissionId')::uuid;
  perform public.complete_judge_submission(capped,(result->>'submissionId')::uuid,'completed','accepted',3,3,1,'synthetic',null,null);
  result := public.reserve_onlinecompiler_submission(capped,problem,key,'java','class Solution {}',starts,ends,20,4,45);
  if result->>'result'<>'existing' then raise exception 'Legacy OnlineCompiler should still replay'; end if;
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
    capped,problem,key,'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'existing' or (result->>'submissionId')::uuid<>attempt then
    raise exception 'Redeploy must replay the original OnlineCompiler rollback reservation';
  end if;
  quota := public.get_user_judge_quota_status(capped,starts,ends,25);
  if (quota->>'used')::int<>3 then
    raise exception 'Each rollback reservation must count once toward the personal limit after redeploy';
  end if;

  for i in 4..25 loop
    result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
      capped,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
    if result->>'result'<>'reserved' then raise exception 'Personal execution % should reserve',i; end if;
    perform public.complete_judge_submission(capped,(result->>'submissionId')::uuid,'completed','accepted',3,3,1,'synthetic',null,null);
  end loop;
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
    capped,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,4,45);
  if result->>'result'<>'exhausted' or (result->>'used')::int<>25 then
    raise exception 'Personal execution 26 must be refused';
  end if;
  -- Aggregate account usage is now greater than 25; a different user still has
  -- their own full allowance, while the global provider concurrency stays bound.
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
    fresh,problem,gen_random_uuid(),'java','class Solution {}',starts,ends,25,1,45);
  if result->>'result'<>'reserved' or (result->>'used')::int<>1 then
    raise exception 'One user must not spend another user allowance';
  end if;
  attempt := (result->>'submissionId')::uuid;
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
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
    'public.reserve_judge_execution(text,text,text,text,uuid[],uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer)','execute')
    or has_table_privilege('authenticated','public.verified_problem_solves','insert')
    or has_table_privilege('service_role','public.verified_problem_solves','insert') then
    raise exception 'Arbitrary recipient grants must not be exposed outside the completion function';
  end if;
  if has_any_column_privilege('authenticated','public.verified_problem_solves','select')
    or has_any_column_privilege('service_role','public.verified_problem_solves','select')
    or has_any_column_privilege('authenticated','public.judge_submission_participants','select')
    or has_function_privilege('authenticated','public.judge_refresh_recipients(uuid,uuid)','execute') then
    raise exception 'Client solved readback must omit private provenance and recipient rosters';
  end if;
  set local role service_role;
  begin
    perform period_end from public.judge_user_quota_periods where user_id=b and period_start=starts;
    raise exception 'Personal quota must be read through the status RPC';
  exception when insufficient_privilege then null; end;
  quota := public.get_user_judge_quota_status(b,starts,ends,25);
  if quota->>'admission' is distinct from 'exhausted' or (quota->>'used')::int is distinct from 0 then
    raise exception 'The service role must still be able to read personal quota through the status RPC';
  end if;
  select count(*) into credits from public.judge_refresh_recipients(accepted_submit,a) r where r.user_id in(a,b);
  if credits<>2 or exists(select 1 from public.judge_refresh_recipients(accepted_submit,a) r where r.user_id=late)
    or exists(select 1 from public.judge_refresh_recipients(accepted_submit,b))
    or exists(select 1 from public.judge_refresh_recipients(repeated_submit,a)) then
    raise exception 'Refresh must target captured first-time solvers for the original actor only';
  end if;
  reset role;
  perform set_config('request.jwt.claim.sub',a::text,true);
  set local role authenticated;
  select to_jsonb(s) into result from public.submissions s where s.id=accepted_submit;
  if result is null or result ? 'execution_room_id' or result ? 'participants_captured_at' then
    raise exception 'An actor can read their own submission without capture provenance';
  end if;
  reset role;
  perform set_config('request.jwt.claim.sub',b::text,true);
  set local role authenticated;
  if public.has_verified_problem_solve(problem) is distinct from true then
    raise exception 'A captured peer must be able to read their boolean solved state';
  end if;
  result := public.save_practice_draft(b,problem,'shared baseline',null);
  draft_saved_at := (result->>'last_saved_at')::timestamptz;
  if draft_saved_at is null then raise exception 'An owner must be able to save a first draft'; end if;
  if result - 'last_saved_at' is distinct from '{"solved_at":null,"solved_with":[]}'::jsonb then
    raise exception 'Draft save must return only its version and historical display fields: %', result;
  end if;
  if public.save_practice_draft(b,problem,'stale first save',null) is not null then
    raise exception 'A stale first save must not overwrite an existing draft';
  end if;
  result := public.save_practice_draft(b,problem,'newer tab edit',draft_saved_at);
  if (result->>'last_saved_at')::timestamptz<=draft_saved_at then
    raise exception 'A successful save must advance the draft version';
  end if;
  if public.save_practice_draft(b,problem,'older tab edit',draft_saved_at) is not null
    or (select draft_code from public.user_problem_progress where user_id=b and problem_id=problem)
      is distinct from 'newer tab edit' then
    raise exception 'A stale tab must not overwrite newer persisted code';
  end if;
  begin
    perform public.save_practice_draft(a,problem,'wrong owner',null);
    raise exception 'A draft save cannot target a different user';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_problem_progress(user_id,problem_id,draft_code,draft_language,last_saved_at)
    values(b,problem,'legacy tab edit','java',now())
    on conflict(user_id,problem_id) do update set
      draft_code=excluded.draft_code,draft_language=excluded.draft_language,last_saved_at=excluded.last_saved_at;
    raise exception 'Legacy Save draft must not bypass the version check';
  exception when insufficient_privilege then null; end;
  begin
    update public.user_problem_progress set last_saved_at=null where user_id=b and problem_id=problem;
    raise exception 'Direct writes must not clear the current draft version';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_problem_progress(user_id,problem_id,draft_code)
      select b,id,'unversioned first draft' from public.problems where slug='bracket-beacon';
    raise exception 'A first draft must also use the version-checked save';
  exception when insufficient_privilege then null; end;
  perform public.record_problem_grade(problem,'good');
  if not exists(select 1 from public.user_problem_progress
    where user_id=b and problem_id=problem and draft_code='newer tab edit' and review_grade='good') then
    raise exception 'Review grading must preserve the current draft';
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
  perform public.complete_judge_submission(late,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  result := public.reserve_judge_execution('user','onlinecompiler','run',null,null,
    late,problem,key,'java','class Solution {}',starts+interval '11 days',ends+interval '11 days',25,4,45);
  if result->>'result'<>'existing' or (result->>'submissionId')::uuid<>attempt
    or (result->>'used')::int<>0 or (result->>'limit')::int<>25
    or exists(select 1 from public.judge_quota_periods where period_start=starts+interval '11 days')
    or exists(select 1 from public.judge_user_quota_periods where user_id=late and period_start=starts+interval '11 days')
    or not exists(select 1 from public.submissions where id=attempt and execution_action='legacy' and quota_scope='shared')
    or exists(select 1 from public.verified_problem_solves where submission_id=attempt) then
    raise exception 'A legacy retry must read the original outcome without changing state';
  end if;
  result := public.reserve_judge_execution('shared','onlinecompiler','run',null,null,
    late,problem,key,'java','class Solution {}',starts+interval '10 days',ends+interval '10 days',20,4,45);
  if result->>'result'<>'existing' or (result->>'used')::int<>1 then
    raise exception 'Evaluation retries must replay legacy attempts without charging';
  end if;
  begin
    perform public.reserve_judge_execution('user','onlinecompiler','submit',null,array[late],
      late,problem,key,'java','class Solution {}',starts+interval '11 days',ends+interval '11 days',25,4,45);
    raise exception 'Legacy executions must not replay as Submit';
  exception when invalid_parameter_value then null; end;
  delete from auth.users where id=a;
  if exists(select 1 from public.submissions where user_id=a)
    or exists(select 1 from public.judge_submission_participants where submission_id=accepted_submit)
    or not exists(select 1 from public.verified_problem_solves where user_id=b and problem_id=problem and submission_id is null) then
    raise exception 'Deleting the actor must remove attempt provenance and retain peer credit';
  end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  set local role authenticated;
  if public.has_verified_problem_solve(problem) is distinct from true then
    raise exception 'The peer must still read their solve after the submitting actor is deleted';
  end if;
  reset role;
end $$;
do $$
declare
  actor uuid := gen_random_uuid();
  problem uuid := (select id from public.problems where slug='parcel-pair');
  scope text; action text; runner text; key uuid; result jsonb; attempt uuid;
  old_start timestamptz := '2197-01-01T23:55:00Z'; new_start timestamptz;
begin
  insert into auth.users(id,email) values(actor,'expired-retry@example.test');
  for scope, action, runner in values ('legacy','run','jdoodle'), ('legacy','run','onlinecompiler'),
    ('user','run','jdoodle'), ('user','submit','onlinecompiler'),
    ('shared','run','onlinecompiler'), ('shared','submit','onlinecompiler')
  loop
    key := gen_random_uuid();
    new_start := old_start+interval '1 day';
    if scope='legacy' then
      result := case runner when 'jdoodle' then
        public.reserve_judge_submission(actor,problem,key,'java','class Solution {}',old_start,new_start,20,4,45)
      else
        public.reserve_onlinecompiler_submission(actor,problem,key,'java','class Solution {}',old_start,new_start,20,4,45)
      end;
    else
      result := public.reserve_judge_execution(scope,runner,action,null,
        case when action='submit' then array[actor] else null end,
        actor,problem,key,'java','class Solution {}',old_start,new_start,case scope when 'user' then 25 else 20 end,4,45);
    end if;
    if result->>'result' is distinct from 'reserved' then raise exception 'Fixture did not reserve: %', result; end if;
    attempt := (result->>'submissionId')::uuid;
    update public.submissions set reservation_expires_at=now()-interval '1 second' where id=attempt;

    if scope='legacy' then
      result := case runner when 'jdoodle' then
        public.reserve_judge_submission(actor,problem,key,'java','class Solution {}',new_start,new_start+interval '1 day',20,4,45)
      else
        public.reserve_onlinecompiler_submission(actor,problem,key,'java','class Solution {}',new_start,new_start+interval '1 day',20,4,45)
      end;
    else
      result := public.reserve_judge_execution(scope,runner,action,null,null,
        actor,problem,key,'java','class Solution {}',new_start,new_start+interval '1 day',case scope when 'user' then 25 else 20 end,4,45);
    end if;
    if result->>'result' is distinct from 'existing' or (result->>'submissionId')::uuid is distinct from attempt
      or (result->>'used')::int is distinct from 0
      or not exists(select 1 from public.submissions where id=attempt and judge_state='failed' and verdict='runtime_error')
      or not exists(select 1 from public.judge_quota_periods where period_start=old_start and used=1 and active=0)
      or not exists(select 1 from public.judge_user_quota_periods where user_id=actor and period_start=old_start and used=1)
      or exists(select 1 from public.verified_problem_solves where user_id=actor) then
      raise exception 'Expired % % retry must release its original lease without new usage or credit: %', scope, action, result;
    end if;
    old_start := new_start+interval '1 day';
  end loop;
end $$;
rollback;
