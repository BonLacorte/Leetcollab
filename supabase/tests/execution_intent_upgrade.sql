\set ON_ERROR_STOP on
begin;
do $$
declare
  actor uuid := '21950000-0000-4000-8000-000000000001';
  peer uuid := '21950000-0000-4000-8000-000000000002';
  problem uuid := (select id from public.problems where slug='parcel-pair');
  manual_problem uuid := (select id from public.problems where slug='bracket-beacon');
  starts timestamptz := '2195-01-01T23:55:00Z';
  actor_used integer;
begin
  select used into actor_used from public.judge_user_quota_periods where user_id=actor and period_start=starts;
  if actor_used is distinct from 2
    or exists(select 1 from public.judge_user_quota_periods where user_id=peer and period_start=starts)
    or (select used from public.judge_quota_periods where period_start=starts) is distinct from 2 then
    raise exception 'Legacy pass and failure must both carry into personal usage without changing account usage';
  end if;

  perform set_config('request.jwt.claim.sub',actor::text,true);
  set local role authenticated;
  if public.has_verified_problem_solve(problem) is distinct from true
    or public.has_verified_problem_solve(manual_problem) is distinct from false then
    raise exception 'Upgrade must grandfather the verified actor solve and leave manual completion unverified';
  end if;
  perform set_config('request.jwt.claim.sub',peer::text,true);
  if public.has_verified_problem_solve(problem) is distinct from false
    or public.has_verified_problem_solve(manual_problem) is distinct from false then
    raise exception 'Upgrade must not infer historical peer credit';
  end if;
  reset role;
end $$;
rollback;
