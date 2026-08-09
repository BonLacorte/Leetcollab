create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 32),
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.problems (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null unique,
  category text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  sort_order integer not null unique,
  statement text not null,
  starter_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_problem_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  is_liked boolean not null default false,
  is_starred boolean not null default false,
  solved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, problem_id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  language text not null,
  source_code text not null,
  status text not null check (status in ('queued', 'accepted', 'wrong_answer', 'error')),
  created_at timestamptz not null default now()
);

create index submissions_user_id_created_at_idx on public.submissions(user_id, created_at desc);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.touch_updated_at();
create trigger problems_updated_at before update on public.problems
for each row execute procedure public.touch_updated_at();
create trigger user_problem_progress_updated_at before update on public.user_problem_progress
for each row execute procedure public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.problems enable row level security;
alter table public.user_problem_progress enable row level security;
alter table public.submissions enable row level security;

create policy "everyone can read problems" on public.problems
for select to anon, authenticated using (true);

create policy "users can read their profile" on public.profiles
for select to authenticated using (auth.uid() = id);
create policy "users can update their profile" on public.profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "users can read their progress" on public.user_problem_progress
for select to authenticated using (auth.uid() = user_id);
create policy "users can create their progress" on public.user_problem_progress
for insert to authenticated with check (auth.uid() = user_id);
create policy "users can update their progress" on public.user_problem_progress
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users can read their submissions" on public.submissions
for select to authenticated using (auth.uid() = user_id);
create policy "users can create their submissions" on public.submissions
for insert to authenticated with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select on public.problems to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.user_problem_progress to authenticated;
grant select, insert on public.submissions to authenticated;
