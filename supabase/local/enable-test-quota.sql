-- LOCAL DEVELOPMENT ONLY. Do not add this script to migrations or apply it to hosted databases.
-- The preview owner applies this explicitly after stopping admission and verifying
-- the account allowance. It preserves usage and all existing reservation rules.
-- Function bodies follow 202611100001_backend_mvp.sql, with only the 50 ceiling
-- and the internal reservation name from 202611150002_onlinecompiler_reservations.sql.
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

alter table public.judge_quota_periods
  drop constraint judge_quota_periods_quota_limit_check,
  add constraint judge_quota_periods_quota_limit_check check (quota_limit between 1 and 50);

create or replace function public.get_judge_quota_status(
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_quota_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quota public.judge_quota_periods;
begin
  if p_quota_limit < 1 or p_quota_limit > 50 or p_period_end <= p_period_start then
    raise exception 'invalid quota period' using errcode = '22023';
  end if;

  insert into public.judge_quota_periods (period_start, period_end, quota_limit)
  values (p_period_start, p_period_end, p_quota_limit)
  on conflict (period_start) do update set
    quota_limit = least(public.judge_quota_periods.quota_limit, excluded.quota_limit),
    updated_at = now();

  select * into quota from public.judge_quota_periods where period_start = p_period_start;
  return jsonb_build_object(
    'used', quota.used,
    'limit', quota.quota_limit,
    'active', quota.active,
    'resetAt', quota.period_end
  );
end;
$$;

create or replace function public.reserve_judge_submission_internal(
  p_user_id uuid,
  p_problem_id uuid,
  p_idempotency_key uuid,
  p_language text,
  p_source_code text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_quota_limit integer,
  p_active_limit integer,
  p_reservation_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quota public.judge_quota_periods;
  existing public.submissions;
  created public.submissions;
  expired_count integer := 0;
begin
  if p_language <> 'java' or char_length(p_source_code) < 1 or char_length(p_source_code) > 32768 then
    raise exception 'invalid submission' using errcode = '22023';
  end if;
  if p_quota_limit < 1 or p_quota_limit > 50 or p_active_limit < 1
    or p_reservation_seconds < 5 or p_reservation_seconds > 120
    or p_period_end <= p_period_start then
    raise exception 'invalid quota configuration' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.problem_judge_configs c
    join public.problems p on p.id = c.problem_id
    where c.problem_id = p_problem_id and c.language = p_language and p.is_enabled
  ) then
    return jsonb_build_object('result', 'problem_not_found');
  end if;

  insert into public.judge_quota_periods (period_start, period_end, quota_limit)
  values (p_period_start, p_period_end, p_quota_limit)
  on conflict (period_start) do update set
    quota_limit = least(public.judge_quota_periods.quota_limit, excluded.quota_limit),
    updated_at = now();

  select * into quota from public.judge_quota_periods
  where period_start = p_period_start for update;

  with expired as (
    update public.submissions
    set judge_state = 'failed',
        status = 'error',
        verdict = 'runtime_error',
        diagnostics = 'The judge reservation expired before completion.',
        completed_at = now()
    where quota_period_start = p_period_start
      and judge_state = 'reserved'
      and reservation_expires_at <= now()
    returning 1
  ) select count(*) into expired_count from expired;

  if expired_count > 0 then
    update public.judge_quota_periods
    set active = greatest(0, active - expired_count), updated_at = now()
    where period_start = p_period_start
    returning * into quota;
  end if;

  select * into existing from public.submissions
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'result', case when existing.judge_state = 'reserved' then 'in_progress' else 'existing' end,
      'submissionId', existing.id,
      'used', quota.used,
      'limit', quota.quota_limit,
      'active', quota.active,
      'resetAt', quota.period_end
    );
  end if;

  if quota.used >= quota.quota_limit then
    return jsonb_build_object(
      'result', 'exhausted', 'used', quota.used, 'limit', quota.quota_limit,
      'active', quota.active, 'resetAt', quota.period_end
    );
  end if;
  if quota.active >= p_active_limit then
    return jsonb_build_object(
      'result', 'busy', 'used', quota.used, 'limit', quota.quota_limit,
      'active', quota.active, 'resetAt', quota.period_end
    );
  end if;

  insert into public.submissions (
    user_id, problem_id, language, source_code, status, idempotency_key,
    verification, runner, fixture_version, judge_state, quota_period_start,
    reservation_expires_at
  )
  select
    p_user_id, p_problem_id, p_language, p_source_code, 'queued', p_idempotency_key,
    'leetcollab', 'jdoodle', c.fixture_version, 'reserved', p_period_start,
    now() + make_interval(secs => p_reservation_seconds)
  from public.problem_judge_configs c
  where c.problem_id = p_problem_id
  returning * into created;

  update public.judge_quota_periods
  set used = used + 1, active = active + 1, updated_at = now()
  where period_start = p_period_start
  returning * into quota;

  return jsonb_build_object(
    'result', 'reserved', 'submissionId', created.id,
    'used', quota.used, 'limit', quota.quota_limit,
    'active', quota.active, 'resetAt', quota.period_end
  );
end;
$$;

-- Status/reservation RPCs deliberately never raise an existing period's limit.
-- Raise only the current local period explicitly, retaining used and active.
-- The 50 ceiling includes executions already charged in this period.
update public.judge_quota_periods
set quota_limit = 50, updated_at = now()
where period_start = date_trunc('day', now() + interval '5 minutes') - interval '5 minutes';

-- New per-user allowances retain exactly the same charged usage.
do $$ begin
  if to_regclass('public.judge_user_quota_periods') is not null then
    update public.judge_user_quota_periods set quota_limit=50
      where period_start=date_trunc('day',now()+interval '5 minutes')-interval '5 minutes';
  end if;
end $$;

commit;
