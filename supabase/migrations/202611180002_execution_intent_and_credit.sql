-- Stop admission and let outstanding reservations settle before applying.
-- Retain account accounting, every historical submission, and all consumed usage.
begin;
lock table public.judge_quota_periods, public.submissions in access exclusive mode;
do $$ begin
  if exists (select 1 from public.submissions where judge_state = 'reserved') then
    raise exception 'Settle active judge reservations before migrating execution intent';
  end if;
end $$;

alter table public.judge_quota_periods add column provider_exhausted boolean not null default false;
alter table public.submissions
  add column execution_action text not null default 'legacy' check (execution_action in ('legacy','run','submit')),
  add column quota_scope text not null default 'shared' check (quota_scope in ('shared','user'));

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
  room_id text check (room_id ~ '^[a-z0-9]{8}$'),
  primary key (submission_id, user_id)
);
create table public.verified_problem_solves (
  user_id uuid not null references public.profiles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  primary key (user_id, problem_id)
);
create index on public.submissions(reservation_expires_at)
  where judge_state='reserved' and quota_period_start is not null;
create index on public.verified_problem_solves(submission_id) where submission_id is not null;
alter table public.judge_user_quota_periods enable row level security;
alter table public.judge_submission_participants enable row level security;
alter table public.verified_problem_solves enable row level security;
revoke all on public.judge_user_quota_periods, public.judge_submission_participants,
  public.verified_problem_solves from public, anon, authenticated, service_role;
create function public.has_verified_problem_solve(p_problem_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.verified_problem_solves where user_id=auth.uid() and problem_id=p_problem_id
  )
$$;
revoke all on function public.has_verified_problem_solve(uuid) from public,anon,authenticated,service_role;
grant execute on function public.has_verified_problem_solve(uuid) to authenticated;

-- Historical buttons were indistinguishable. Preserve their already verified
-- solved evidence, without retroactively granting unknown room partners credit.
insert into public.verified_problem_solves(user_id,problem_id)
select distinct user_id,problem_id from public.submissions
where verification='leetcollab' and judge_state='completed' and verdict='accepted'
  and tests_total > 0 and tests_passed=tests_total;
insert into public.judge_user_quota_periods(user_id,period_start,period_end,quota_limit,used)
select s.user_id,q.period_start,q.period_end,25,count(*)::integer
from public.submissions s join public.judge_quota_periods q on q.period_start=s.quota_period_start
where s.verification='leetcollab' group by s.user_id,q.period_start,q.period_end;

create function public.charge_personal_judge_quota()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.judge_user_quota_periods(user_id,period_start,period_end,quota_limit,used)
    select new.user_id,period_start,period_end,25,1
    from public.judge_quota_periods where period_start=new.quota_period_start
    on conflict(user_id,period_start) do update set used=judge_user_quota_periods.used+1;
  return new;
end $$;
revoke all on function public.charge_personal_judge_quota() from public,anon,authenticated,service_role;
create trigger charge_personal_judge_quota
  after insert on public.submissions for each row
  when (new.verification='leetcollab' and new.judge_state='reserved')
  execute function public.charge_personal_judge_quota();

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

alter function public.complete_judge_submission(uuid,uuid,text,text,integer,integer,integer,text,text,text)
  rename to complete_judge_submission_account_internal;
revoke all on function public.complete_judge_submission_account_internal(uuid,uuid,text,text,integer,integer,integer,text,text,text)
  from public,anon,authenticated,service_role;
create function public.expire_prior_judge_reservation(
  p_user_id uuid,p_idempotency_key uuid,p_runner text,p_problem_id uuid,
  p_language text,p_source_code text,p_period_start timestamptz,p_admitted_at timestamptz
) returns void language plpgsql security definer set search_path=public as $$
declare attempt_id uuid;
begin
  select id into attempt_id from public.submissions
    where user_id=p_user_id and idempotency_key=p_idempotency_key
      and runner=p_runner and problem_id=p_problem_id and language=p_language and source_code=p_source_code
      and verification='leetcollab' and judge_state='reserved'
      and quota_period_start<p_period_start and reservation_expires_at<=p_admitted_at;
  if found then
    perform public.complete_judge_submission_account_internal(p_user_id,attempt_id,'failed','runtime_error',
      0,0,0,'The judge reservation expired before completion.',null,null);
  end if;
end $$;
revoke all on function public.expire_prior_judge_reservation(uuid,uuid,text,uuid,text,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;

create function public.reserve_judge_execution_internal(
  p_scope text, p_runner text, p_action text, p_room_id text, p_participant_ids uuid[],
  p_user_id uuid, p_problem_id uuid, p_idempotency_key uuid, p_language text, p_source_code text,
  p_period_start timestamptz, p_period_end timestamptz, p_quota_limit integer,
  p_active_limit integer, p_reservation_seconds integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare account public.judge_quota_periods; personal public.judge_user_quota_periods;
  attempt public.submissions; result jsonb; outcome text; expired_count integer; active_count integer;
  admitted_at timestamptz;
  no_snapshot boolean := p_room_id is null and p_participant_ids is null;
begin
  if p_scope is null or p_scope not in ('user','shared') or p_runner is null or p_runner not in ('jdoodle','onlinecompiler')
    or (not no_snapshot and (
      p_action <> 'submit' or
      p_participant_ids is null or not (p_user_id=any(p_participant_ids))
      or cardinality(p_participant_ids) not between 1 and 256
      or array_position(p_participant_ids,null) is not null
      or (p_room_id is null and p_participant_ids <> array[p_user_id])
      or (p_scope='shared' and p_room_id is not null)
      or (p_room_id is not null and p_room_id !~ '^[a-z0-9]{8}$')
    )) then
    raise exception 'invalid execution context' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('leetcollab:judge:admission', 0));
  admitted_at := case when p_scope='user' then clock_timestamp() else now() end;
  if p_scope='user' then
    p_period_start := date_bin(interval '24 hours',admitted_at,timestamptz '2000-01-01 23:55+00');
    p_period_end := p_period_start+interval '24 hours';
  end if;
  perform public.expire_prior_judge_reservation(p_user_id,p_idempotency_key,p_runner,p_problem_id,p_language,p_source_code,
    p_period_start,admitted_at);
  if p_action <> 'legacy' then
    select * into attempt from public.submissions
      where user_id=p_user_id and idempotency_key=p_idempotency_key
        and execution_action='legacy' and judge_state<>'reserved';
  end if;
  if attempt.id is not null then
    if p_scope='shared' then
      select * into account from public.judge_quota_periods where period_start=p_period_start;
      result := jsonb_build_object('used',coalesce(account.used,0),
        'limit',least(coalesce(account.quota_limit,p_quota_limit),p_quota_limit),'active',coalesce(account.active,0),
        'resetAt',coalesce(account.period_end,p_period_end));
    else
      select * into personal from public.judge_user_quota_periods where user_id=p_user_id and period_start=p_period_start;
      select count(*) into active_count from public.submissions where user_id=p_user_id
        and quota_scope='user' and quota_period_start=p_period_start and judge_state='reserved' and reservation_expires_at>admitted_at;
      result := jsonb_build_object('used',coalesce(personal.used,0),
        'limit',least(coalesce(personal.quota_limit,p_quota_limit),p_quota_limit),'active',active_count,
        'resetAt',coalesce(personal.period_end,p_period_end));
    end if;
    result := result || jsonb_build_object('result','existing','submissionId',attempt.id);
  else
    if p_language <> 'java' or char_length(p_source_code) not between 1 and 32768
      or p_quota_limit not between 1 and (case p_scope when 'shared' then 20 else 50 end)
      or p_active_limit is null or p_active_limit < 1 or p_reservation_seconds not between 5 and 120
      or p_period_end <= p_period_start then
      raise exception 'invalid execution configuration' using errcode='22023';
    end if;
    if not exists (select 1 from public.problem_judge_configs c join public.problems p on p.id=c.problem_id
      where c.problem_id=p_problem_id and c.language=p_language and p.is_enabled) then
      return jsonb_build_object('result','problem_not_found');
    end if;

    if p_scope='shared' then
      insert into public.judge_quota_periods(period_start,period_end,quota_limit)
        values(p_period_start,p_period_end,p_quota_limit)
        on conflict(period_start) do update set
          quota_limit=least(judge_quota_periods.quota_limit,excluded.quota_limit),updated_at=admitted_at;
    else
      insert into public.judge_quota_periods(period_start,period_end,quota_limit)
        values(p_period_start,p_period_end,20) on conflict do nothing;
    end if;
    select * into strict account from public.judge_quota_periods where period_start=p_period_start for update;
    with expired as (
      update public.submissions set judge_state='failed',status='error',verdict='runtime_error',
        diagnostics='The judge reservation expired before completion.',completed_at=admitted_at
      where quota_period_start=p_period_start and judge_state='reserved' and reservation_expires_at<=admitted_at returning 1
    ) select count(*) into expired_count from expired;
    if expired_count > 0 then
      update public.judge_quota_periods set active=greatest(0,active-expired_count),updated_at=admitted_at
        where period_start=p_period_start returning * into account;
    end if;
    if p_scope='user' then
      result := public.get_user_judge_quota_status(p_user_id,p_period_start,p_period_end,p_quota_limit);
    end if;
    select * into attempt from public.submissions where user_id=p_user_id and idempotency_key=p_idempotency_key;
    if found then
      outcome := case when attempt.judge_state='reserved' then 'in_progress' else 'existing' end;
    elsif account.provider_exhausted
      or (p_scope='shared' and account.used >= account.quota_limit)
      or (p_scope='user' and (result->>'used')::integer >= (result->>'limit')::integer) then
      outcome := 'exhausted';
    elsif (select count(*) from public.submissions
      where judge_state='reserved' and quota_period_start is not null and reservation_expires_at>admitted_at) >= p_active_limit then
      outcome := 'busy';
    else
      if p_action='submit' and no_snapshot then
        raise exception 'new submit requires captured participants' using errcode='22023';
      end if;
      if p_action='submit' and p_scope='user' and p_room_id is null then
        raise exception 'new personal submit requires a room' using errcode='22023';
      end if;
      insert into public.submissions(user_id,problem_id,idempotency_key,language,source_code,status,verification,runner,
        fixture_version,judge_state,quota_period_start,reservation_expires_at,quota_scope,execution_action)
      select p_user_id,p_problem_id,p_idempotency_key,p_language,p_source_code,'queued','leetcollab',p_runner,
        c.fixture_version,'reserved',p_period_start,admitted_at+make_interval(secs=>p_reservation_seconds),p_scope,p_action
      from public.problem_judge_configs c where c.problem_id=p_problem_id returning * into attempt;
      update public.judge_quota_periods set used=used+1,active=active+1,updated_at=admitted_at
        where period_start=p_period_start returning * into account;
      if p_scope='user' then
        result := public.get_user_judge_quota_status(p_user_id,p_period_start,p_period_end,p_quota_limit);
      end if;
      outcome := 'reserved';
    end if;
    if p_scope='shared' then
      result := jsonb_build_object('used',account.used,'limit',account.quota_limit,'active',account.active,'resetAt',account.period_end);
    end if;
    result := result || jsonb_build_object('result',outcome);
    if attempt.id is not null then
      result := result || jsonb_build_object('submissionId',attempt.id);
    end if;
  end if;

  if result->>'result'='reserved' and p_action='submit' then
    insert into public.judge_submission_participants(submission_id,user_id,room_id)
      select attempt.id,profile.id,p_room_id from public.profiles profile
      where profile.id=any(p_participant_ids)
      order by profile.id for key share of profile;
  elsif result->>'result' in ('existing','in_progress') then
    if p_action='legacy' then
      if attempt.runner is distinct from p_runner then
        raise exception 'idempotency key belongs to another judge runner' using errcode='22023';
      end if;
    elsif attempt.verification <> 'leetcollab'
      or attempt.runner is distinct from p_runner or attempt.problem_id is distinct from p_problem_id
      or attempt.language is distinct from p_language or attempt.source_code is distinct from p_source_code
      or (attempt.execution_action='legacy' and p_action<>'run')
      or (attempt.execution_action<>'legacy' and (attempt.execution_action<>p_action or attempt.quota_scope<>p_scope)) then
      raise exception 'idempotency key belongs to another execution' using errcode='22023';
    end if;
  end if;
  -- Replays retain the ORIGINAL room and participant snapshot, even if the actor
  -- has since left or changed rooms. Current membership cannot change credit.
  return result;
end $$;
revoke all on function public.reserve_judge_execution_internal(
  text,text,text,text,uuid[],uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer
) from public,anon,authenticated,service_role;

create function public.reserve_judge_execution(
  p_scope text, p_runner text, p_action text, p_room_id text, p_participant_ids uuid[],
  p_user_id uuid, p_problem_id uuid, p_idempotency_key uuid, p_language text, p_source_code text,
  p_period_start timestamptz, p_period_end timestamptz, p_quota_limit integer,
  p_active_limit integer, p_reservation_seconds integer
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_action is null or p_action not in ('run','submit') then
    raise exception 'invalid execution context' using errcode='22023';
  end if;
  return public.reserve_judge_execution_internal(p_scope,p_runner,p_action,p_room_id,p_participant_ids,
    p_user_id,p_problem_id,p_idempotency_key,p_language,p_source_code,
    p_period_start,p_period_end,p_quota_limit,p_active_limit,p_reservation_seconds);
end $$;

create or replace function public.reserve_judge_submission_for_runner(
  p_runner text,p_user_id uuid,p_problem_id uuid,p_idempotency_key uuid,p_language text,p_source_code text,
  p_period_start timestamptz,p_period_end timestamptz,p_quota_limit integer,p_active_limit integer,p_reservation_seconds integer
) returns jsonb language sql security definer set search_path=public as $$
  select public.reserve_judge_execution_internal('shared',p_runner,'legacy',null,null,
    p_user_id,p_problem_id,p_idempotency_key,p_language,p_source_code,
    p_period_start,p_period_end,p_quota_limit,p_active_limit,p_reservation_seconds);
$$;

drop function public.reserve_judge_submission_internal(
  uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer
);

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
      select profile.id,attempt.problem_id,attempt.id
      from public.judge_submission_participants participant
      join public.profiles profile on profile.id=participant.user_id
      where participant.submission_id=attempt.id
      order by profile.id for key share of profile on conflict do nothing;
  end if;
  if attempt.quota_scope='user' then
    select * into strict personal from public.judge_user_quota_periods
      where user_id=p_user_id and period_start=attempt.quota_period_start;
    result := result || public.get_user_judge_quota_status(p_user_id,personal.period_start,personal.period_end,personal.quota_limit);
  end if;
  return result;
end $$;

create function public.judge_refresh_recipients(p_submission_id uuid, p_actor_id uuid)
returns table(user_id uuid, room_id text, problem_id uuid)
language sql stable security definer set search_path=public as $$
  select credit.user_id, participant.room_id, s.problem_id
    from public.submissions s join public.verified_problem_solves credit on credit.submission_id=s.id
    join public.judge_submission_participants participant
      on participant.submission_id=s.id and participant.user_id=credit.user_id
    where s.id=p_submission_id and s.user_id=p_actor_id and participant.room_id is not null
      and s.execution_action='submit' and s.quota_scope='user'
$$;
revoke all on function public.judge_refresh_recipients(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.judge_refresh_recipients(uuid,uuid) to service_role;

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
  public.reserve_judge_execution(text,text,text,text,uuid[],uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer),
  public.complete_judge_submission(uuid,uuid,text,text,integer,integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.get_user_judge_quota_status(uuid,timestamptz,timestamptz,integer),
  public.reserve_judge_execution(text,text,text,text,uuid[],uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,integer,integer),
  public.complete_judge_submission(uuid,uuid,text,text,integer,integer,integer,text,text,text) to service_role;

revoke insert, update on public.user_problem_progress from public, anon, authenticated;
grant insert (user_id, problem_id, is_liked, is_starred, solved_at, updated_at, solved_with, solved_code,
    review_grade, last_reviewed_at, suggested_review_at),
  update (is_liked, is_starred, solved_at, updated_at, solved_with, solved_code,
    review_grade, last_reviewed_at, suggested_review_at)
  on public.user_problem_progress to authenticated;

create function public.save_practice_draft(
  p_user_id uuid, p_problem_id uuid, p_draft_code text, p_expected_saved_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved record;
begin
  if auth.uid() is distinct from p_user_id or p_user_id is null then
    raise exception 'draft owner authentication required' using errcode='42501';
  end if;
  if p_expected_saved_at is null then
    insert into public.user_problem_progress(user_id,problem_id,draft_code,draft_language,last_saved_at)
      values(p_user_id,p_problem_id,p_draft_code,'java',clock_timestamp())
      on conflict(user_id,problem_id) do update set
        draft_code=excluded.draft_code,draft_language='java',last_saved_at=clock_timestamp()
      where user_problem_progress.last_saved_at is null
      returning last_saved_at, solved_at, solved_with into saved;
  else
    update public.user_problem_progress set draft_code=p_draft_code,draft_language='java',
      last_saved_at=greatest(clock_timestamp(),p_expected_saved_at+interval '1 microsecond')
      where user_id=p_user_id and problem_id=p_problem_id and last_saved_at=p_expected_saved_at
      returning last_saved_at, solved_at, solved_with into saved;
  end if;
  if not found then return null; end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.save_practice_draft(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_practice_draft(uuid,uuid,text,timestamptz) to authenticated;
commit;
