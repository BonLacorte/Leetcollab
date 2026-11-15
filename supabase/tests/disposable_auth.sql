-- Only for a fresh disposable PostgreSQL test database, never hosted Supabase.
-- Minimal auth contract consumed by application migrations and RLS regressions.
-- This does not claim hosted auth parity or create any real session/credential.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant all on schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
