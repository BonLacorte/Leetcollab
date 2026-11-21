\set ON_ERROR_STOP on
begin;
do $$
declare
  actor uuid := '21950000-0000-4000-8000-000000000001';
  peer uuid := '21950000-0000-4000-8000-000000000002';
  problem uuid := (select id from public.problems where slug='parcel-pair');
  manual_problem uuid := (select id from public.problems where slug='bracket-beacon');
  starts timestamptz := '2195-01-01T23:55:00Z';
  ends timestamptz := starts+interval '1 day';
  attempt uuid;
begin
  insert into auth.users(id,email) values (actor,'legacy-actor@example.test'),(peer,'legacy-peer@example.test');
  attempt := (public.reserve_onlinecompiler_submission(actor,problem,gen_random_uuid(),
    'java','class Solution {}',starts,ends,20,4,45)->>'submissionId')::uuid;
  perform public.complete_judge_submission(actor,attempt,'completed','accepted',3,3,1,'synthetic',null,null);
  attempt := (public.reserve_judge_submission(actor,problem,gen_random_uuid(),
    'java','class Solution {}',starts,ends,20,4,45)->>'submissionId')::uuid;
  perform public.complete_judge_submission(actor,attempt,'failed','runtime_error',0,0,1,'synthetic',null,null);
  insert into public.user_problem_progress(user_id,problem_id,solved_at,solved_with)
  values (actor,manual_problem,now(),jsonb_build_array(jsonb_build_object('userId',peer,'username','legacy-peer'))),
    (peer,problem,now(),'[]');
end $$;
commit;
