-- LOCAL DEVELOPMENT ONLY. Do not add this script to migrations or apply it to hosted databases.
\set ON_ERROR_STOP on
begin;
lock table public.judge_quota_periods in access exclusive mode;

do $$
begin
  if exists (select 1 from public.judge_quota_periods where active > 0) then
    raise exception 'Wait for active judge reservations before changing the local test allowance';
  end if;
end;
$$;

update public.judge_user_quota_periods
set quota_limit = 50
where period_start = (date_trunc('day', (now() at time zone 'UTC') + interval '5 minutes') - interval '5 minutes') at time zone 'UTC';

commit;
