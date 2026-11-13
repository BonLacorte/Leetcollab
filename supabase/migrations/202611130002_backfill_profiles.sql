do $$
begin
  create temporary table missing_profile_users (
    id uuid,
    email text,
    raw_user_meta_data jsonb
  ) on commit drop;

  create trigger recover_missing_profile
    after insert on missing_profile_users
    for each row execute function public.handle_new_user();

  insert into missing_profile_users (id, email, raw_user_meta_data)
  select u.id, u.email, u.raw_user_meta_data
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id)
  order by u.created_at, u.id;

  drop table missing_profile_users;
end;
$$;
