-- Offline prerequisites only. No policy is installed and no production caller uses
-- these RPCs. All prices/limits require a separately reviewed operator policy.
create table public.render_admission_policy (
  singleton boolean primary key check (singleton),
  policy_id uuid not null unique,
  review_reference text not null check (length(trim(review_reference)) between 1 and 2048),
  valid_until timestamptz not null,
  workspace_id text not null check (workspace_id ~ '^tea-[0-9a-v]{20}$'),
  group_id text not null check (group_id ~ '^sbg-[0-9a-v]{20}$'),
  image_id text not null check (image_id ~ '^sbb-[0-9a-v]{20}$'),
  toolchain text not null check (length(trim(toolchain)) between 1 and 256),
  daily_limit integer not null check (daily_limit > 0),
  monthly_limit integer not null check (monthly_limit > 0),
  active_limit integer not null check (active_limit > 0),
  -- Conservative, reviewed all-in upper charge per attempt, in integer micro USD.
  -- Includes failed/unknown creation and every applicable lifecycle charge path.
  attempt_cost_microusd bigint not null check (attempt_cost_microusd > 0),
  monthly_budget_microusd bigint not null check (monthly_budget_microusd > 0)
);

create table public.render_execution_attempts (
  -- RESTRICT preserves cost/ambiguity evidence even if account deletion is requested.
  submission_id uuid primary key references public.submissions(id) on delete restrict,
  policy_id uuid not null,
  review_reference text not null,
  provenance jsonb not null,
  admitted_at timestamptz not null,
  reserved_cost_microusd bigint not null check (reserved_cost_microusd > 0),
  phase text not null check (phase in ('reserved', 'creating', 'acknowledged', 'unknown', 'settled')),
  resource_id text check (resource_id ~ '^sbx-[0-9a-v]{1,64}$'),
  cleanup_acknowledged_at timestamptz,
  reconciliation_id uuid
);
create index render_attempts_admitted_idx on public.render_execution_attempts(admitted_at);
create index render_attempts_unsettled_idx on public.render_execution_attempts(phase) where phase <> 'settled';

-- Only an operator/database owner may supply this evidence. The broker can refer
-- to a prior record but cannot manufacture resolution authority or refund usage.
create table public.render_reconciliation_evidence (
  id uuid primary key,
  submission_id uuid not null references public.render_execution_attempts(submission_id),
  operator_reference text not null check (length(trim(operator_reference)) between 1 and 2048),
  evidence_reference text not null check (length(trim(evidence_reference)) between 1 and 2048),
  resource_ids text[] not null,
  confirmed_terminal_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (confirmed_terminal_at <= recorded_at)
);
alter table public.render_execution_attempts add foreign key (reconciliation_id)
  references public.render_reconciliation_evidence(id);

alter table public.render_admission_policy enable row level security;
alter table public.render_execution_attempts enable row level security;
alter table public.render_reconciliation_evidence enable row level security;
revoke all on public.render_admission_policy, public.render_execution_attempts,
  public.render_reconciliation_evidence from public, anon, authenticated, service_role;

create function public.get_render_quota_status(p_policy_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  policy public.render_admission_policy;
  instant timestamptz := clock_timestamp();
  day_start timestamptz := date_trunc('day', instant at time zone 'UTC') at time zone 'UTC';
  used_count bigint;
  active_count bigint;
  used_month bigint;
  reserved_cost numeric;
  ambiguous boolean;
  month_start timestamptz := date_trunc('month', instant at time zone 'UTC') at time zone 'UTC';
begin
  select * into policy from public.render_admission_policy where singleton and policy_id = p_policy_id;
  if not found then
    raise exception 'reviewed Render policy required' using errcode = '22023';
  end if;
  select count(*) filter (where admitted_at >= day_start), count(*) filter (where phase <> 'settled'),
    count(*) filter (where admitted_at >= month_start),
    coalesce(sum(reserved_cost_microusd) filter (where admitted_at >= month_start), 0),
    coalesce(bool_or(phase in ('creating', 'unknown')), false)
    into used_count, active_count, used_month, reserved_cost, ambiguous from public.render_execution_attempts
    where admitted_at >= month_start or phase <> 'settled';
  return jsonb_build_object('used', used_count, 'limit', policy.daily_limit,
    'active', active_count, 'resetAt', day_start + interval '24 hours',
    'admission', case when policy.valid_until <= instant then 'unconfigured'
      when ambiguous then 'busy'
      when used_count >= policy.daily_limit or used_month >= policy.monthly_limit
        or reserved_cost + policy.attempt_cost_microusd > policy.monthly_budget_microusd then 'exhausted'
      when active_count >= policy.active_limit then 'busy' else 'available' end);
end;
$$;

create function public.reserve_render_submission(
  p_user_id uuid, p_problem_id uuid, p_idempotency_key uuid, p_source_code text,
  p_policy_id uuid, p_provenance jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  policy public.render_admission_policy;
  previous public.submissions;
  previous_attempt public.render_execution_attempts;
  created_id uuid;
  instant timestamptz;
  day_start timestamptz;
  month_start timestamptz;
  used_day bigint;
  used_month bigint;
  reserved_cost numeric;
  active_count bigint;
  ambiguous boolean;
  expected_provenance jsonb;
  quota jsonb;
begin
  -- One shared provider row serializes day, month, cost and active admission,
  -- including policy revisions. There is no lease expiry or automatic refund.
  select * into policy from public.render_admission_policy where singleton for update;
  instant := clock_timestamp();
  if not found or policy.policy_id is distinct from p_policy_id or policy.valid_until <= instant then
    raise exception 'reviewed Render policy required' using errcode = '22023';
  end if;
  expected_provenance := jsonb_build_object('provider', 'render', 'workspaceId', policy.workspace_id,
    'groupId', policy.group_id, 'imageId', policy.image_id, 'toolchain', policy.toolchain);
  if p_provenance is distinct from expected_provenance
    or p_user_id is null or p_problem_id is null or p_idempotency_key is null
    or p_source_code is null or char_length(p_source_code) not between 1 and 32768
    or octet_length(p_source_code) > 65536 then
    raise exception 'invalid Render attempt binding' using errcode = '22023';
  end if;
  quota := public.get_render_quota_status(p_policy_id);
  select * into previous from public.submissions
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    select * into previous_attempt from public.render_execution_attempts where submission_id = previous.id;
    if not found or previous.runner is distinct from 'render'
      or previous.problem_id is distinct from p_problem_id or previous.source_code is distinct from p_source_code
      or previous_attempt.policy_id is distinct from p_policy_id
      or previous_attempt.provenance is distinct from expected_provenance then
      raise exception 'idempotency key already bound to another attempt' using errcode = '22023';
    end if;
    return quota || jsonb_build_object('result', case when previous.judge_state = 'reserved'
      then 'in_progress' else 'existing' end, 'submissionId', previous.id);
  end if;
  if not exists (select 1 from public.problem_judge_configs c join public.problems p on p.id=c.problem_id
      where c.problem_id=p_problem_id and c.language='java' and p.is_enabled) then
    return quota || jsonb_build_object('result', 'problem_not_found');
  end if;
  day_start := date_trunc('day', instant at time zone 'UTC') at time zone 'UTC';
  month_start := date_trunc('month', instant at time zone 'UTC') at time zone 'UTC';
  select count(*) filter (where admitted_at >= day_start),
    count(*) filter (where admitted_at >= month_start),
    coalesce(sum(reserved_cost_microusd) filter (where admitted_at >= month_start), 0),
    count(*) filter (where phase <> 'settled'),
    coalesce(bool_or(phase in ('creating', 'unknown')), false)
    into used_day, used_month, reserved_cost, active_count, ambiguous
    from public.render_execution_attempts where admitted_at >= month_start or phase <> 'settled';
  if ambiguous then
    return quota || jsonb_build_object('result', 'busy');
  end if;
  if used_day >= policy.daily_limit or used_month >= policy.monthly_limit
    or reserved_cost + policy.attempt_cost_microusd > policy.monthly_budget_microusd then
    return quota || jsonb_build_object('result', 'exhausted');
  end if;
  if active_count >= policy.active_limit then
    return quota || jsonb_build_object('result', 'busy');
  end if;
  insert into public.submissions(user_id, problem_id, language, source_code, status, idempotency_key,
    verification, runner, fixture_version, judge_state)
    select p_user_id, p_problem_id, 'java', p_source_code, 'queued', p_idempotency_key,
      'leetcollab', 'render', fixture_version, 'reserved'
    from public.problem_judge_configs where problem_id=p_problem_id returning id into created_id;
  insert into public.render_execution_attempts(submission_id, policy_id, review_reference, provenance,
    admitted_at, reserved_cost_microusd, phase)
    values(created_id, policy.policy_id, policy.review_reference, expected_provenance,
      instant, policy.attempt_cost_microusd, 'reserved');
  return public.get_render_quota_status(p_policy_id) || jsonb_build_object('result', 'reserved', 'submissionId', created_id);
end;
$$;

create function public.record_render_attempt(p_user_id uuid, p_submission_id uuid, p_phase text, p_resource_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  attempt public.render_execution_attempts;
begin
  perform 1 from public.render_admission_policy where singleton for update;
  select a.* into attempt from public.render_execution_attempts a join public.submissions s on s.id=a.submission_id
    where a.submission_id=p_submission_id and s.user_id=p_user_id for update of a;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  if p_phase = 'creating' and attempt.phase = 'reserved' and p_resource_id is null then
    if exists(select 1 from public.render_execution_attempts where phase in ('creating', 'unknown')) then
      raise exception 'unresolved Render creation' using errcode = '55000';
    end if;
    update public.render_execution_attempts set phase='creating' where submission_id=p_submission_id;
  elsif p_phase = 'acknowledged' and attempt.phase in ('creating', 'acknowledged', 'unknown')
    and p_resource_id is not null and p_resource_id ~ '^sbx-[0-9a-v]{1,64}$'
    and (attempt.resource_id is null or attempt.resource_id = p_resource_id) then
    update public.render_execution_attempts set resource_id=p_resource_id,
      phase=case when phase='unknown' then 'unknown' else 'acknowledged' end where submission_id=p_submission_id;
  elsif p_phase = 'settled' and attempt.phase in ('acknowledged', 'settled')
    and attempt.resource_id = p_resource_id and attempt.reconciliation_id is null then
    update public.render_execution_attempts set phase='settled', cleanup_acknowledged_at=coalesce(cleanup_acknowledged_at, clock_timestamp())
      where submission_id=p_submission_id;
  else
    -- A second begin must never authorize another POST, and cleanup cannot resolve
    -- an already ambiguous attempt even if a late resource ID becomes available.
    raise exception 'invalid Render attempt transition' using errcode = '55000';
  end if;
end;
$$;

create function public.reconcile_render_attempt(p_submission_id uuid, p_evidence_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  attempt public.render_execution_attempts;
  evidence public.render_reconciliation_evidence;
begin
  perform 1 from public.render_admission_policy where singleton for update;
  select * into attempt from public.render_execution_attempts where submission_id=p_submission_id for update;
  if not found then raise exception 'attempt not found' using errcode = 'P0002'; end if;
  select * into evidence from public.render_reconciliation_evidence
    where id=p_evidence_id and submission_id=p_submission_id and recorded_at <= clock_timestamp();
  if not found or evidence.confirmed_terminal_at < attempt.admitted_at
    or (attempt.resource_id is not null and not (attempt.resource_id = any(evidence.resource_ids))) then
    raise exception 'prior operator terminal evidence required' using errcode = '42501';
  end if;
  if attempt.phase='settled' and attempt.reconciliation_id=p_evidence_id then return; end if;
  if attempt.phase not in ('creating', 'acknowledged', 'unknown', 'reserved') then
    raise exception 'invalid reconciliation' using errcode = '55000';
  end if;
  update public.render_execution_attempts set phase='settled', reconciliation_id=p_evidence_id where submission_id=p_submission_id;
  update public.submissions set judge_state='failed', status='error', verdict='runtime_error', tests_passed=0,
    diagnostics='The attempt was reconciled by the operator; use a new submission key.', completed_at=clock_timestamp()
    where id=p_submission_id and judge_state='reserved';
end;
$$;

revoke all on function public.get_render_quota_status(uuid),
  public.reserve_render_submission(uuid, uuid, uuid, text, uuid, jsonb),
  public.record_render_attempt(uuid, uuid, text, text), public.reconcile_render_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_render_quota_status(uuid),
  public.reserve_render_submission(uuid, uuid, uuid, text, uuid, jsonb),
  public.record_render_attempt(uuid, uuid, text, text), public.reconcile_render_attempt(uuid, uuid) to service_role;

-- Keep server comparison/persistence on the existing shared completion contract.
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
  attempt public.render_execution_attempts;
  render_policy_id uuid;
begin
  if p_judge_state is null or p_verdict is null or p_tests_passed is null or p_tests_total is null or p_duration_ms is null
    or p_judge_state not in ('completed', 'failed')
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
  if target.runner = 'render' then
    select policy_id into render_policy_id from public.render_admission_policy where singleton for update;
    select * into target from public.submissions where id=p_submission_id and user_id=p_user_id for update;
    select * into attempt from public.render_execution_attempts where submission_id=target.id for update;
    if not found then raise exception 'Render attempt missing' using errcode = '55000'; end if;
    if target.judge_state <> 'reserved' then
      return public.get_render_quota_status(render_policy_id) || jsonb_build_object('result', 'existing', 'submissionId', target.id);
    end if;
    if p_judge_state='completed' and attempt.phase <> 'settled' then
      raise exception 'Render cleanup evidence required' using errcode = '55000';
    end if;
    if p_judge_state='failed' then
      update public.render_execution_attempts set phase=case when phase='reserved' then 'settled'
        when phase='settled' then 'settled' else 'unknown' end where submission_id=target.id;
    end if;
  else
    select * into quota from public.judge_quota_periods
    where period_start = target.quota_period_start for update;
  end if;

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

  if target.runner = 'render' then
    return public.get_render_quota_status(render_policy_id) || jsonb_build_object('result', 'completed', 'submissionId', target.id);
  end if;

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
