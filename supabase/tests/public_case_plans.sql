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
    if config.public_case_plan->'format' is distinct from '"framed-v1"'::jsonb
      or config.public_case_plan->'fixtureVersion' is distinct from to_jsonb(config.fixture_version)
      or config.public_case_plan->'harnessSha256' is distinct from to_jsonb(encode(sha256(convert_to(config.harness_source, 'UTF8')), 'hex'))
      or jsonb_typeof(config.public_case_plan->'cases') is distinct from 'array' then
      raise exception 'Invalid reviewed metadata for %', config.slug;
    end if;
    if jsonb_array_length(config.public_case_plan->'cases') <> 2 then
      raise exception 'Expected two reviewed cases for %', config.slug;
    end if;
    for index in 0..1 loop
      example := config.examples->index;
      approved := config.public_case_plan->'cases'->index;
      if jsonb_typeof(example->'input') is distinct from 'string'
        or jsonb_typeof(example->'output') is distinct from 'string'
        or jsonb_typeof(example->'title') is distinct from 'string'
        or approved->'input' is distinct from example->'input'
        or approved->'expected' is distinct from example->'output'
        or approved->'title' is distinct from example->'title'
        or approved->'id' is distinct from to_jsonb(config.slug || ':' || (index+1))
        or approved->'expected' is distinct from config.expected_output->index
        or approved->'fixtureIndex' is distinct from to_jsonb(index) then
        raise exception 'Public mapping does not correspond to published example for %', config.slug;
      end if;
    end loop;
    if config.slug = 'parcel-pair' and (config.fixture_version is distinct from 2
      or config.expected_output is distinct from '["[2, 3]","[]","[0, 2]"]'::jsonb) then
      raise exception 'Unexpected Parcel Pair fixture metadata';
    end if;
  end loop;
  if count <> 15 then raise exception 'Expected 15 reviewed curriculum mappings, got %', count; end if;
  if has_table_privilege('authenticated', 'public.problem_judge_configs', 'select') then
    raise exception 'Private fixture metadata must retain its existing database grants';
  end if;
end;
$$;
rollback;
