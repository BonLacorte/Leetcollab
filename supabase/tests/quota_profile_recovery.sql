\set ON_ERROR_STOP on
begin;

insert into public.judge_quota_periods(period_start, period_end, quota_limit, used)
values ('2190-01-01', '2190-01-02', 20, 15), ('2190-01-02', '2190-01-03', 20, 15);

do $$
declare
  result jsonb;
begin
  result := public.get_judge_quota_status('2190-01-01', '2190-01-02', 10);
  if (result->>'used')::int <> 15 or (result->>'limit')::int <> 10
    or (result->>'resetAt')::timestamptz <> '2190-01-02'::timestamptz then
    raise exception 'lowered status must preserve usage and reset time';
  end if;
  result := public.reserve_judge_submission(gen_random_uuid(),
    (select problem_id from public.problem_judge_configs limit 1),
    gen_random_uuid(), 'java', 'class Solution {}',
    '2190-01-02', '2190-01-03', 10, 2, 45);
  if result->>'result' <> 'exhausted' or (result->>'used')::int <> 15
    or (result->>'limit')::int <> 10 then
    raise exception 'lowered reservation must reject execution and preserve usage';
  end if;
  result := public.exhaust_judge_quota('2190-01-02');
  if (result->>'used')::int <> 15 or (result->>'limit')::int <> 10 then
    raise exception 'provider exhaustion must preserve usage above a lowered limit';
  end if;
  result := public.get_judge_quota_status('2190-01-01', '2190-01-02', 20);
  if (result->>'limit')::int <> 10 then
    raise exception 'higher configuration must not restore spent capacity';
  end if;
  insert into public.judge_quota_periods(period_start, period_end, quota_limit, used)
  values ('2190-01-03', '2190-01-04', 20, 1);
  result := public.exhaust_judge_quota('2190-01-03');
  if (result->>'used')::int <> 20 then
    raise exception 'provider exhaustion must consume remaining capacity';
  end if;
end;
$$;

insert into auth.users(id,email,raw_user_meta_data) values
('feed0000-0000-4000-8000-000000000001','recover@example.test','{"username":"recovery_user","name":"Existing"}'),
('feed0001-0000-4000-8000-000000000002','recover2@example.test','{"username":"recovery_user","name":"Recovered","picture":"https://example.test/avatar"}'),
('feed0002-0000-4000-8000-000000000003','x@example.test','{"username":"!!"}');
delete from public.profiles where id in
('feed0001-0000-4000-8000-000000000002','feed0002-0000-4000-8000-000000000003');
create temporary table preserved_profiles as select * from public.profiles;
create temporary table preserved_auth as select * from auth.users;
\ir ../migrations/202611130002_backfill_profiles.sql
create temporary table recovered_profiles as select * from public.profiles;
\ir ../migrations/202611130002_backfill_profiles.sql

do $$
begin
  if exists (select * from preserved_profiles except select * from public.profiles)
    or exists (select * from preserved_auth except select * from auth.users)
    or exists (select * from auth.users except select * from preserved_auth)
    or exists (select * from recovered_profiles except select * from public.profiles)
    or exists (select * from public.profiles except select * from recovered_profiles) then
    raise exception 'backfill must preserve profiles and auth and be idempotent';
  end if;
  if not exists (select 1 from public.profiles
    where id = 'feed0001-0000-4000-8000-000000000002'
      and username = 'recovery_user_feed0001' and full_name = 'Recovered'
      and avatar_url = 'https://example.test/avatar') then
    raise exception 'missing profile must use signup collision and metadata behavior';
  end if;
  if not exists (select 1 from public.profiles
    where id = 'feed0002-0000-4000-8000-000000000003' and username = 'coder') then
    raise exception 'missing profile must use signup normalization';
  end if;
end;
$$;
rollback;
