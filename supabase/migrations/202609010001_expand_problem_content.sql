alter table public.problems
add column if not exists examples jsonb not null default '[]'::jsonb,
add column if not exists constraints text[] not null default '{}';
