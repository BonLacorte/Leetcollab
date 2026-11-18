-- Disposable migrated database only. No Java executes and no provider is called.
\set ON_ERROR_STOP on
begin;
do $$
declare
  config record;
  example jsonb;
  approved jsonb;
  count integer := 0;
begin
  for config in select c.*, p.slug, p.examples from public.problem_judge_configs c
    join public.problems p on p.id = c.problem_id where c.public_case_plan is not null loop
    count := count + 1;
    if config.public_case_plan->>'format' <> 'framed-v1'
      or (config.public_case_plan->>'fixtureVersion')::integer <> config.fixture_version
      or config.public_case_plan->>'harnessSha256' <> encode(sha256(convert_to(config.harness_source, 'UTF8')), 'hex')
      or jsonb_array_length(config.public_case_plan->'cases') <> 2 then
      raise exception 'Invalid reviewed metadata for %', config.slug;
    end if;
    for index in 0..1 loop
      example := config.examples->index;
      approved := config.public_case_plan->'cases'->index;
      if approved->>'input' <> example->>'input' or approved->>'expected' <> example->>'output'
        or approved->>'title' <> example->>'title'
        or approved->>'id' <> config.slug || ':' || (index+1)
        or approved->>'expected' <> config.expected_output->>((approved->>'fixtureIndex')::integer)
        or (approved->>'fixtureIndex')::integer <> index then
        raise exception 'Public mapping does not correspond to published example for %', config.slug;
      end if;
    end loop;
    if config.slug = 'parcel-pair' and (config.fixture_version <> 2
      or config.expected_output <> '["[2, 3]","[]","[0, 2]"]'::jsonb
      or position('new int[]{5,6}' in config.harness_source) >= position('new int[]{6,2,8}' in config.harness_source)) then
      raise exception 'Parcel Pair must execute both public cases before the private invocation';
    end if;
  end loop;
  if count <> 15 then raise exception 'Expected 15 reviewed curriculum mappings, got %', count; end if;
  if has_table_privilege('authenticated', 'public.problem_judge_configs', 'select') then
    raise exception 'Private fixture metadata must retain its existing database grants';
  end if;
end;
$$;
rollback;
