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
  set used = greatest(used, quota_limit), updated_at = now()
  where period_start = p_period_start
  returning * into quota;
  return jsonb_build_object(
    'used', quota.used, 'limit', quota.quota_limit,
    'active', quota.active, 'resetAt', quota.period_end
  );
end;
$$;
