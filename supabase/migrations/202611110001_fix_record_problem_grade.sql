-- Qualify the upsert target so PL/pgSQL does not confuse the problem_id
-- output column with user_problem_progress.problem_id.
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
  on conflict on constraint user_problem_progress_pkey do update set
    review_grade = excluded.review_grade,
    last_reviewed_at = excluded.last_reviewed_at,
    suggested_review_at = excluded.suggested_review_at;

  insert into public.problem_review_attempts (
    user_id, problem_id, grade, reviewed_at, suggested_review_at
  ) values (caller, p_problem_id, p_grade, reviewed, suggested);

  return query select p_problem_id, p_grade, reviewed, suggested;
end;
$$;
