-- Preserve the existing conservative shared quota and completion contract, while
-- recording which server-selected provider owns an attempt. No data is rewritten.
alter function public.reserve_judge_submission(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer
) rename to reserve_judge_submission_internal;

revoke all on function public.reserve_judge_submission_internal(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer
) from public, anon, authenticated, service_role;

create function public.reserve_judge_submission_for_runner(
  p_runner text,
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
  result jsonb;
  attempt public.submissions;
begin
  if p_runner is null or p_runner not in ('jdoodle', 'onlinecompiler') then
    raise exception 'invalid judge runner' using errcode = '22023';
  end if;

  -- The unchanged reservation function locks the quota row through this whole
  -- transaction. A concurrent request cannot see a new row before its runner is
  -- bound, and the losing provider cannot relabel or execute the winner's row.
  result := public.reserve_judge_submission_internal(
    p_user_id, p_problem_id, p_idempotency_key, p_language, p_source_code,
    p_period_start, p_period_end, p_quota_limit, p_active_limit,
    p_reservation_seconds
  );

  if result->>'result' in ('reserved', 'existing', 'in_progress') then
    select * into attempt from public.submissions
    where id = (result->>'submissionId')::uuid and user_id = p_user_id
    for update;
    if not found then
      raise exception 'judge reservation identity missing' using errcode = '22023';
    end if;

    if result->>'result' = 'reserved' then
      -- Only a row created by this transaction can acquire a different runner.
      if attempt.runner is distinct from 'jdoodle' or attempt.judge_state <> 'reserved' then
        raise exception 'invalid new judge reservation' using errcode = '22023';
      end if;
      update public.submissions set runner = p_runner where id = attempt.id;
    elsif attempt.runner is distinct from p_runner then
      raise exception 'idempotency key belongs to another judge runner' using errcode = '22023';
    end if;
  end if;

  return result;
end;
$$;

revoke all on function public.reserve_judge_submission_for_runner(
  text, uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer
) from public, anon, authenticated, service_role;

-- Public RPC names bind the provider in trusted SQL. Browsers have no execution
-- grant and service_role cannot invoke either internal helper with a chosen label.
create function public.reserve_judge_submission(
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
language sql
security definer
set search_path = public
as $$
  select public.reserve_judge_submission_for_runner(
    'jdoodle', p_user_id, p_problem_id, p_idempotency_key, p_language,
    p_source_code, p_period_start, p_period_end, p_quota_limit, p_active_limit,
    p_reservation_seconds
  );
$$;

create function public.reserve_onlinecompiler_submission(
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
language sql
security definer
set search_path = public
as $$
  select public.reserve_judge_submission_for_runner(
    'onlinecompiler', p_user_id, p_problem_id, p_idempotency_key, p_language,
    p_source_code, p_period_start, p_period_end, p_quota_limit, p_active_limit,
    p_reservation_seconds
  );
$$;

revoke all on function public.reserve_judge_submission(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.reserve_onlinecompiler_submission(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_judge_submission(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer
) to service_role;
grant execute on function public.reserve_onlinecompiler_submission(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, integer, integer, integer
) to service_role;
