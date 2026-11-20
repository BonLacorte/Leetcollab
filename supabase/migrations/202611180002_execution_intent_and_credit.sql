-- Stop admission and let outstanding reservations settle before applying.
-- Retain account accounting, every historical submission, and all consumed usage.
begin;
lock table public.judge_quota_periods, public.submissions in access exclusive mode;
do $$ begin
  if exists (select 1 from public.submissions where judge_state = 'reserved') then
    raise exception 'Settle active judge reservations before migrating execution intent';
  end if;
end $$;

alter table public.judge_quota_periods drop constraint judge_quota_periods_quota_limit_check,
  add constraint judge_quota_periods_quota_limit_check check (quota_limit between 1 and 50);
alter table public.judge_quota_periods add column provider_exhausted boolean not null default false;
alter table public.submissions
  add column execution_action text not null default 'legacy' check (execution_action in ('legacy','run','submit')),
  add column quota_scope text not null default 'shared' check (quota_scope in ('shared','user')),
  add column execution_room_id text,
  add column participants_captured_at timestamptz;
-- Old server callers can execute, but cannot implicitly manufacture Submit credit.
alter table public.submissions alter column execution_action set default 'run';

create table public.judge_user_quota_periods (
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  quota_limit integer not null check (quota_limit between 1 and 50),
  used integer not null default 0 check (used >= 0),
  primary key (user_id, period_start),
  check (period_end > period_start)
);
create table public.judge_submission_participants (
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (submission_id, user_id)
);
create table public.verified_problem_solves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  credited_at timestamptz not null default now(),
  primary key (user_id, problem_id, submission_id)
);
alter table public.judge_user_quota_periods enable row level security;
alter table public.judge_submission_participants enable row level security;
alter table public.verified_problem_solves enable row level security;
revoke all on public.judge_user_quota_periods, public.judge_submission_participants,
  public.verified_problem_solves from public, anon, authenticated, service_role;
grant select on public.verified_problem_solves to authenticated, service_role;
grant select on public.judge_user_quota_periods to service_role;
create policy "users read their verified solved credit" on public.verified_problem_solves
  for select to authenticated using (auth.uid() = user_id);

-- Historical buttons were indistinguishable. Preserve their already verified
-- solved evidence, without retroactively granting unknown room partners credit.
insert into public.verified_problem_solves(user_id,problem_id,submission_id,credited_at)
select user_id,problem_id,id,coalesce(completed_at,created_at) from public.submissions
where verification='leetcollab' and judge_state='completed' and verdict='accepted'
  and tests_total > 0 and tests_passed=tests_total;
insert into public.judge_user_quota_periods(user_id,period_start,period_end,quota_limit,used)
select s.user_id,q.period_start,q.period_end,greatest(25,q.quota_limit),count(*)::integer
from public.submissions s join public.judge_quota_periods q on q.period_start=s.quota_period_start
where s.verification='leetcollab' group by s.user_id,q.period_start,q.period_end,q.quota_limit;

create function public.get_user_judge_quota_status(
  p_user_id uuid, p_period_start timestamptz, p_period_end timestamptz, p_quota_limit integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.judge_user_quota_periods; active_count integer;
begin
  if p_quota_limit < 1 or p_quota_limit > 50 or p_period_end <= p_period_start then
    raise exception 'invalid user quota' using errcode='22023';
  end if;
  insert into public.judge_user_quota_periods(user_id,period_start,period_end,quota_limit,used)
  values(p_user_id,p_period_start,p_period_end,p_quota_limit,0)
  on conflict(user_id,period_start) do update set
    quota_limit=least(judge_user_quota_periods.quota_limit,excluded.quota_limit);
  select * into strict q from public.judge_user_quota_periods
    where user_id=p_user_id and period_start=p_period_start;
  select count(*) into active_count from public.submissions where user_id=p_user_id
    and quota_scope='user' and quota_period_start=p_period_start and judge_state='reserved'
    and reservation_expires_at > now();
  return jsonb_build_object('used',q.used,'limit',q.quota_limit,'active',active_count,'resetAt',q.period_end,
    'admission',case when exists(select 1 from public.judge_quota_periods
      where period_start=p_period_start and provider_exhausted) then 'exhausted' else 'available' end);
end $$;

create function public.reserve_judge_execution(
  p_scope text, p_runner text, p_action text, p_room_id text, p_participant_ids uuid[], p_captured_at timestamptz,
  p_user_id uuid, p_problem_id uuid, p_idempotency_key uuid, p_language text, p_source_code text,
  p_period_start timestamptz, p_period_end timestamptz, p_quota_limit integer,
  p_active_limit integer, p_reservation_seconds integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare account public.judge_quota_periods; personal public.judge_user_quota_periods;
  attempt public.submissions; result jsonb; expired_count integer;
  replay_only boolean := p_action='submit' and p_room_id is null and p_participant_ids is null and p_captured_at is null;
begin
  if p_scope is null or p_scope not in ('user','shared') or p_runner is null or p_runner not in ('jdoodle','onlinecompiler')
    or p_action is null or p_action not in ('run','submit')
    or (not replay_only and (
      p_captured_at is null or p_participant_ids is null or not (p_user_id=any(p_participant_ids))
      or cardinality(p_participant_ids) not between 1 and 256
      or array_position(p_participant_ids,null) is not null
      or (p_room_id is null and p_participant_ids <> array[p_user_id])
      or (p_room_id is not null and p_room_id !~ '^[a-z0-9]{8}$')
    )) then
    raise exception 'invalid execution context' using errcode='22023';
  end if;
  if p_scope='shared' then
    -- Restricted evaluation retains the existing account budget and admission.
    result := public.reserve_judge_submission_for_runner(p_runner,p_user_id,p_problem_id,p_idempotency_key,
      p_language,p_source_code,p_period_start,p_period_end,p_quota_limit,p_active_limit,p_reservation_seconds);
  else
    if p_language <> 'java' or char_length(p_source_code) not between 1 and 32768
      or p_quota_limit not between 1 and 50 or p_active_limit < 1
      or p_reservation_seconds not between 5 and 120 or p_period_end <= p_period_start then
      raise exception 'invalid execution configuration' using errcode='22023';
    end if;
    if not exists (select 1 from public.problem_judge_configs c join public.problems p on p.id=c.problem_id
      where c.problem_id=p_problem_id and c.language=p_language and p.is_enabled) then
      return jsonb_build_object('result','problem_not_found');
    end if;
    -- Account row still serializes every reservation and bounds GLOBAL active
    -- provider requests. Its used counter remains an aggregate audit ledger;
    -- personal allowance, rather than that old shared ceiling, admits this call.
    insert into public.judge_quota_periods(period_start,period_end,quota_limit)
      values(p_period_start,p_period_end,p_quota_limit) on conflict do nothing;
    select * into strict account from public.judge_quota_periods where period_start=p_period_start for update;
    with expired as (
      update public.submissions set judge_state='failed',status='error',verdict='runtime_error',
        diagnostics='The judge reservation expired before completion.',completed_at=now()
      where quota_period_start=p_period_start and judge_state='reserved' and reservation_expires_at<=now() returning 1
    ) select count(*) into expired_count from expired;
    if expired_count > 0 then
      update public.judge_quota_periods set active=greatest(0,active-expired_count),updated_at=now()
        where period_start=p_period_start returning * into account;
    end if;
    perform public.get_user_judge_quota_status(p_user_id,p_period_start,p_period_end,p_quota_limit);
    select * into strict personal from public.judge_user_quota_periods
      where user_id=p_user_id and period_start=p_period_start for update;
    result := public.get_user_judge_quota_status(p_user_id,p_period_start,p_period_end,p_quota_limit);
    select * into attempt from public.submissions where user_id=p_user_id and idempotency_key=p_idempotency_key;
    if found then
      result := result || jsonb_build_object('result',case when attempt.judge_state='reserved' then 'in_progress' else 'existing' end,'submissionId',attempt.id);
    elsif personal.used >= personal.quota_limit or account.provider_exhausted then
      return result || jsonb_build_object('result','exhausted');
    elsif account.active >= p_active_limit then
      return result || jsonb_build_object('result','busy');
    else
      insert into public.submissions(user_id,problem_id,idempotency_key,language,source_code,status,verification,runner,
        fixture_version,judge_state,quota_period_start,reservation_expires_at,quota_scope)
      select p_user_id,p_problem_id,p_idempotency_key,p_language,p_source_code,'queued','leetcollab',p_runner,
        c.fixture_version,'reserved',p_period_start,now()+make_interval(secs=>p_reservation_seconds),'user'
      from public.problem_judge_configs c where c.problem_id=p_problem_id returning * into attempt;
      update public.judge_user_quota_periods set used=used+1 where user_id=p_user_id and period_start=p_period_start;
      update public.judge_quota_periods set used=used+1,active=active+1,updated_at=now() where period_start=p_period_start;
      result := public.get_user_judge_quota_status(p_user_id,p_period_start,p_period_end,p_quota_limit)
        || jsonb_build_object('result','reserved','submissionId',attempt.id);
    end if;
  end if;
  if result->>'result'='reserved' then
    if replay_only then
      raise exception 'new submit requires captured participants' using errcode='22023';
    end if;
    if p_scope='shared' then
      insert into public.judge_user_quota_periods(user_id,period_start,period_end,quota_limit,used)
      values(p_user_id,p_period_start,p_period_end,25,1)
      on conflict(user_id,period_start) do update set used=judge_user_quota_periods.used+1;
    end if;
    update public.submissions set execution_action=p_action,execution_room_id=p_room_id,
      participants_captured_at=p_captured_at where id=(result->>'submissionId')::uuid;
    insert into public.judge_submission_participants(submission_id,user_id)
      select (result->>'submissionId')::uuid,unnest(p_participant_ids) on conflict do nothing;
  elsif result->>'result' in ('existing','in_progress') then
    select * into strict attempt from public.submissions where id=(result->>'submissionId')::uuid;
    if attempt.runner <> p_runner or attempt.problem_id <> p_problem_id or attempt.source_code <> p_source_code
      or attempt.execution_action <> p_action
      or attempt.quota_scope <> p_scope then
      raise exception 'idempotency key belongs to another execution' using errcode='22023';
    end if;
  end if;
  -- Replays retain the ORIGINAL room and participant snapshot, even if the actor
  -- has since left or changed rooms. Current membership cannot change credit.
  return result;
end $$;

alter function public.complete_judge_submission(uuid,uuid,text,text,integer,integer,integer,text,text,text)
  rename to complete_judge_submission_account_internal;
revoke all on function public.complete_judge_submission_account_internal(uuid,uuid,text,text,integer,integer,integer,text,text,text)
  from public,anon,authenticated,service_role;
create function public.complete_judge_submission(
  p_user_id uuid,p_submission_id uuid,p_judge_state text,p_verdict text,p_tests_passed integer,p_tests_total integer,
  p_duration_ms integer,p_diagnostics text,p_provider_cpu_time text,p_provider_memory text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; attempt public.submissions; personal public.judge_user_quota_periods;
begin
  result := public.complete_judge_submission_account_internal(p_user_id,p_submission_id,p_judge_state,p_verdict,
    p_tests_passed,p_tests_total,p_duration_ms,p_diagnostics,p_provider_cpu_time,p_provider_memory);
  select * into strict attempt from public.submissions where id=p_submission_id and user_id=p_user_id;
  if result->>'result'='completed' and attempt.execution_action='submit' and attempt.judge_state='completed'
    and attempt.verdict='accepted' and attempt.tests_total>0 and attempt.tests_passed=attempt.tests_total then
    insert into public.verified_problem_solves(user_id,problem_id,submission_id)
      select user_id,attempt.problem_id,attempt.id from public.judge_submission_participants where submission_id=attempt.id
      on conflict do nothing;
  end if;
  if attempt.quota_scope='user' then
    select * into strict personal from public.judge_user_quota_periods
      where user_id=p_user_id and period_start=attempt.quota_period_start;
    result := result || public.get_user_judge_quota_status(p_user_id,personal.period_start,personal.period_end,personal.quota_limit);
  end if;
  return result;
end $$;

alter function public.exhaust_judge_quota(timestamptz) rename to exhaust_judge_quota_account_internal;
revoke all on function public.exhaust_judge_quota_account_internal(timestamptz) from public,anon,authenticated,service_role;
create function public.exhaust_judge_quota(p_period_start timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  result := public.exhaust_judge_quota_account_internal(p_period_start);
  update public.judge_quota_periods set provider_exhausted=true where period_start=p_period_start;
  return result;
end $$;
revoke all on function public.exhaust_judge_quota(timestamptz) from public,anon,authenticated;
grant execute on function public.exhaust_judge_quota(timestamptz) to service_role;

revoke all on function public.get_user_judge_quota_status(uuid,timestamptz,timestamptz,integer),
  public.reserve_judge_execution(text,text,text,text,uuid[],timestamptz,uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer),
  public.complete_judge_submission(uuid,uuid,text,text,integer,integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.get_user_judge_quota_status(uuid,timestamptz,timestamptz,integer),
  public.reserve_judge_execution(text,text,text,text,uuid[],timestamptz,uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer),
  public.complete_judge_submission(uuid,uuid,text,text,integer,integer,integer,text,text,text) to service_role;
commit;
