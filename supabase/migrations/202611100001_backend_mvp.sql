-- Durable learning state, private judge fixtures, and server-owned quota accounting.
-- This migration is additive and is safe to apply to an existing project.

alter table public.problems
add column if not exists is_enabled boolean not null default false,
add column if not exists supported_languages text[] not null default array['java']::text[];

alter table public.user_problem_progress
add column if not exists review_grade text,
add column if not exists last_reviewed_at timestamptz,
add column if not exists suggested_review_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_problem_progress_review_grade_check'
  ) then
    alter table public.user_problem_progress
    add constraint user_problem_progress_review_grade_check
    check (review_grade is null or review_grade in ('again', 'hard', 'good', 'easy'));
  end if;
end
$$;

create index if not exists user_problem_progress_due_idx
on public.user_problem_progress (user_id, suggested_review_at)
where suggested_review_at is not null;

alter table public.submissions
add column if not exists idempotency_key uuid,
add column if not exists verification text not null default 'legacy_unverified',
add column if not exists runner text,
add column if not exists fixture_version integer,
add column if not exists judge_state text not null default 'completed',
add column if not exists verdict text,
add column if not exists tests_passed integer not null default 0,
add column if not exists tests_total integer not null default 0,
add column if not exists duration_ms integer,
add column if not exists diagnostics text,
add column if not exists provider_cpu_time text,
add column if not exists provider_memory text,
add column if not exists quota_period_start timestamptz,
add column if not exists reservation_expires_at timestamptz,
add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_verification_check') then
    alter table public.submissions add constraint submissions_verification_check
    check (verification in ('leetcollab', 'legacy_unverified'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'submissions_judge_state_check') then
    alter table public.submissions add constraint submissions_judge_state_check
    check (judge_state in ('reserved', 'completed', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'submissions_verdict_check') then
    alter table public.submissions add constraint submissions_verdict_check
    check (verdict is null or verdict in (
      'accepted', 'wrong_answer', 'compile_error', 'runtime_error',
      'time_limit', 'memory_limit', 'output_limit'
    ));
  end if;
end
$$;

create unique index if not exists submissions_user_id_idempotency_key_idx
on public.submissions (user_id, idempotency_key)
where idempotency_key is not null;

create table if not exists public.problem_judge_configs (
  problem_id uuid primary key references public.problems(id) on delete cascade,
  language text not null check (language = 'java'),
  fixture_version integer not null check (fixture_version > 0),
  harness_source text not null,
  expected_output jsonb not null,
  source_judge_name text,
  source_judge_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(expected_output) = 'array'),
  check ((source_judge_name is null) = (source_judge_url is null)),
  check (source_judge_url is null or source_judge_url ~ '^https://')
);

create table if not exists public.judge_quota_periods (
  period_start timestamptz primary key,
  period_end timestamptz not null,
  quota_limit integer not null check (quota_limit between 1 and 20),
  used integer not null default 0 check (used >= 0),
  active integer not null default 0 check (active >= 0),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  check (used <= quota_limit),
  check (active <= used)
);

create table if not exists public.problem_review_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  grade text not null check (grade in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null default now(),
  suggested_review_at timestamptz not null
);

create index if not exists problem_review_attempts_user_created_idx
on public.problem_review_attempts (user_id, reviewed_at desc);

create table if not exists public.external_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  outcome text not null check (outcome in ('accepted', 'incorrect')),
  verification text not null default 'external_self_reported'
    check (verification = 'external_self_reported'),
  created_at timestamptz not null default now()
);

create index if not exists external_attempts_user_created_idx
on public.external_attempts (user_id, created_at desc);

alter table public.problem_judge_configs enable row level security;
alter table public.judge_quota_periods enable row level security;
alter table public.problem_review_attempts enable row level security;
alter table public.external_attempts enable row level security;

drop policy if exists "everyone can read problems" on public.problems;
create policy "signed in users can read enabled problems" on public.problems
for select to authenticated using (is_enabled);

drop policy if exists "users can create their submissions" on public.submissions;
revoke insert, update, delete on public.submissions from anon, authenticated;
grant select on public.submissions to authenticated;

create policy "users can read their review attempts" on public.problem_review_attempts
for select to authenticated using (auth.uid() = user_id);

create policy "users can read their external attempts" on public.external_attempts
for select to authenticated using (auth.uid() = user_id);

revoke all on public.problem_judge_configs from anon, authenticated;
revoke all on public.judge_quota_periods from anon, authenticated;
revoke insert, update, delete on public.problem_review_attempts from anon, authenticated;
revoke insert, update, delete on public.external_attempts from anon, authenticated;
grant select on public.problem_review_attempts to authenticated;
grant select on public.external_attempts to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_username text;
  candidate text;
begin
  base_username := lower(regexp_replace(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'coder'
    ),
    '[^a-z0-9_]+', '_', 'g'
  ));
  base_username := trim(both '_' from base_username);
  if char_length(base_username) < 3 then
    base_username := 'coder';
  end if;
  candidate := left(base_username, 32);

  begin
    insert into public.profiles (id, username, full_name, avatar_url)
    values (
      new.id,
      candidate,
      nullif(coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name'
      ), ''),
      nullif(coalesce(
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture'
      ), '')
    );
  exception when unique_violation then
    candidate := left(base_username, 23) || '_' || left(replace(new.id::text, '-', ''), 8);
    insert into public.profiles (id, username, full_name, avatar_url)
    values (
      new.id,
      candidate,
      nullif(coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name'
      ), ''),
      nullif(coalesce(
        new.raw_user_meta_data ->> 'avatar_url',
        new.raw_user_meta_data ->> 'picture'
      ), '')
    );
  end;
  return new;
end;
$$;

create or replace function public.record_problem_grade(p_problem_id uuid, p_grade text)
returns table (
  problem_id uuid,
  grade text,
  reviewed_at timestamptz,
  suggested_review_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  reviewed timestamptz := now();
  suggested timestamptz;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_grade not in ('again', 'hard', 'good', 'easy') then
    raise exception 'invalid review grade' using errcode = '22023';
  end if;
  if not exists (select 1 from public.problems p where p.id = p_problem_id and p.is_enabled) then
    raise exception 'problem not found' using errcode = 'P0002';
  end if;

  suggested := reviewed + case p_grade
    when 'again' then interval '1 day'
    when 'hard' then interval '3 days'
    when 'good' then interval '7 days'
    when 'easy' then interval '14 days'
  end;

  insert into public.user_problem_progress (
    user_id, problem_id, review_grade, last_reviewed_at, suggested_review_at
  ) values (caller, p_problem_id, p_grade, reviewed, suggested)
  on conflict (user_id, problem_id) do update set
    review_grade = excluded.review_grade,
    last_reviewed_at = excluded.last_reviewed_at,
    suggested_review_at = excluded.suggested_review_at;

  insert into public.problem_review_attempts (
    user_id, problem_id, grade, reviewed_at, suggested_review_at
  ) values (caller, p_problem_id, p_grade, reviewed, suggested);

  return query select p_problem_id, p_grade, reviewed, suggested;
end;
$$;

create or replace function public.record_external_attempt(p_problem_id uuid, p_outcome text)
returns public.external_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  result public.external_attempts;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_outcome not in ('accepted', 'incorrect') then
    raise exception 'invalid external outcome' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.problem_judge_configs c
    join public.problems p on p.id = c.problem_id
    where c.problem_id = p_problem_id
      and c.source_judge_url is not null
      and p.is_enabled
  ) then
    raise exception 'source judge fallback is not available' using errcode = '42501';
  end if;

  insert into public.external_attempts (user_id, problem_id, outcome)
  values (caller, p_problem_id, p_outcome)
  returning * into result;
  return result;
end;
$$;

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
  if p_quota_limit < 1 or p_quota_limit > 20 or p_period_end <= p_period_start then
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

create or replace function public.reserve_judge_submission(
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
  if p_quota_limit < 1 or p_quota_limit > 20 or p_active_limit < 1
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

create or replace function public.complete_judge_submission(
  p_user_id uuid,
  p_submission_id uuid,
  p_judge_state text,
  p_verdict text,
  p_tests_passed integer,
  p_tests_total integer,
  p_duration_ms integer,
  p_diagnostics text,
  p_provider_cpu_time text,
  p_provider_memory text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.submissions;
  quota public.judge_quota_periods;
begin
  if p_judge_state not in ('completed', 'failed')
    or p_verdict not in ('accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit', 'memory_limit', 'output_limit')
    or p_tests_passed < 0 or p_tests_total < 0 or p_tests_passed > p_tests_total
    or p_duration_ms < 0 then
    raise exception 'invalid completion' using errcode = '22023';
  end if;

  select * into target from public.submissions
  where id = p_submission_id and user_id = p_user_id;
  if not found then
    raise exception 'submission not found' using errcode = 'P0002';
  end if;
  select * into quota from public.judge_quota_periods
  where period_start = target.quota_period_start for update;

  select * into target from public.submissions
  where id = p_submission_id and user_id = p_user_id for update;
  if target.judge_state <> 'reserved' then
    return jsonb_build_object('result', 'existing', 'submissionId', target.id,
      'used', quota.used, 'limit', quota.quota_limit,
      'active', quota.active, 'resetAt', quota.period_end);
  end if;

  update public.submissions set
    judge_state = p_judge_state,
    status = case p_verdict when 'accepted' then 'accepted' when 'wrong_answer' then 'wrong_answer' else 'error' end,
    verdict = p_verdict,
    tests_passed = p_tests_passed,
    tests_total = p_tests_total,
    duration_ms = p_duration_ms,
    diagnostics = left(p_diagnostics, 4096),
    provider_cpu_time = left(p_provider_cpu_time, 64),
    provider_memory = left(p_provider_memory, 64),
    completed_at = now(),
    reservation_expires_at = null
  where id = target.id;

  update public.judge_quota_periods
  set active = greatest(0, active - 1), updated_at = now()
  where period_start = target.quota_period_start
  returning * into quota;

  return jsonb_build_object(
    'result', 'completed', 'submissionId', target.id,
    'used', quota.used, 'limit', quota.quota_limit,
    'active', quota.active, 'resetAt', quota.period_end
  );
end;
$$;

create or replace function public.exhaust_judge_quota(
  p_period_start timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quota public.judge_quota_periods;
begin
  select * into quota from public.judge_quota_periods
  where period_start = p_period_start for update;
  if not found then
    raise exception 'quota period not found' using errcode = 'P0002';
  end if;
  update public.judge_quota_periods
  set used = quota_limit, updated_at = now()
  where period_start = p_period_start
  returning * into quota;
  return jsonb_build_object(
    'used', quota.used, 'limit', quota.quota_limit,
    'active', quota.active, 'resetAt', quota.period_end
  );
end;
$$;

revoke all on function public.get_judge_quota_status(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.reserve_judge_submission(uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_judge_submission(uuid, uuid, text, text, integer, integer, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.exhaust_judge_quota(timestamptz) from public, anon, authenticated;
grant execute on function public.get_judge_quota_status(timestamptz, timestamptz, integer) to service_role;
grant execute on function public.reserve_judge_submission(uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer) to service_role;
grant execute on function public.complete_judge_submission(uuid, uuid, text, text, integer, integer, integer, text, text, text) to service_role;
grant execute on function public.exhaust_judge_quota(timestamptz) to service_role;
revoke all on function public.record_problem_grade(uuid, text) from public, anon;
revoke all on function public.record_external_attempt(uuid, text) from public, anon;
grant execute on function public.record_problem_grade(uuid, text) to authenticated;
grant execute on function public.record_external_attempt(uuid, text) to authenticated;

-- Existing demo exercises were not authored for this curriculum and are not judge-enabled.
update public.problems
set is_enabled = false
where slug in ('two-sum', 'valid-parentheses', 'reverse-linked-list', 'search-a-2d-matrix', 'jump-game');
