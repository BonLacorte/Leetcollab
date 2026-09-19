alter table public.user_problem_progress
add column if not exists draft_code text not null default '',
add column if not exists draft_language text not null default 'javascript',
add column if not exists last_saved_at timestamptz,
add column if not exists solved_with jsonb not null default '[]'::jsonb,
add column if not exists solved_code text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_problem_progress_solved_with_is_array'
  ) then
    alter table public.user_problem_progress
    add constraint user_problem_progress_solved_with_is_array
    check (jsonb_typeof(solved_with) = 'array');
  end if;
end
$$;
