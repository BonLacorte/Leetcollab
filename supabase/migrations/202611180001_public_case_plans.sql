-- Explicit PUBLIC example mappings. Private fixture indexes never cross the API.
-- Parcel Pair originally interleaved a hidden invocation between its examples.
-- Put public invocations first, so hidden input cannot enter a later public
-- result through mutable Solution state. All fixture checks remain present.
alter table public.problem_judge_configs add column public_case_plan jsonb;

update public.problem_judge_configs c
set fixture_version = 2,
    harness_source = $java$class Main {
  public static void main(String[] args) {
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{4,7,1,9}, 10)));
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{5,6}, 20)));
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{6,2,8}, 14)));
  }
}$java$,
    expected_output = '["[2, 3]","[]","[0, 2]"]'::jsonb,
    updated_at = now()
from public.problems p
where c.problem_id = p.id and p.slug = 'parcel-pair' and c.fixture_version = 1
  and c.expected_output = '["[2, 3]","[0, 2]","[]"]'::jsonb
  and encode(sha256(convert_to(c.harness_source, 'UTF8')), 'hex') = '30c7661430e7153f0ee05e4b0bb29a73218040a55f336bf30674e0136c7be0dd';

-- Store the actual public expected value, rather than its prose description.
-- The published statement already specifies an empty string for empty input.
update public.problems p
set examples = jsonb_set(p.examples, '{1,output}', '""'::jsonb), updated_at = now()
from public.problem_judge_configs c
where c.problem_id = p.id and p.slug = 'compact-runs' and c.fixture_version = 1
  and p.examples->1->>'output' = 'empty string'
  and encode(sha256(convert_to(c.harness_source, 'UTF8')), 'hex') = '73eb96569b49a1181f6765eadde475f69ddb45a5f79afec95aa7815d3cfb28ac';

-- Reviewed against 202611100002_curated_problem_fixtures.sql. These are explicit
-- fixture/example associations, not a first-N inference. Hash/version checks
-- leave modified or future fixtures without public details until reviewed.
with approved(slug, version, harness_sha256, fixture_indexes, example_indexes) as (
  values
    ('parcel-pair', 2, '6d5183bdabefcb566e4ff0103481656ef87026f2e9eff5a9b65daed7f7e848da', array[0,1], array[0,1]),
    ('bracket-beacon', 1, 'baa733a618fa03402e93f6958fcf96e89a7a5baf654f26cd7190e45a96e1ebea', array[0,1], array[0,1]),
    ('checkpoint-reversal', 1, '3007e12bf0f8f5314ab6a6a0320cc44c4c688c08c343cfeb43be2760ebf260de', array[0,1], array[0,1]),
    ('first-ready-slot', 1, '0eb783db093068eb95e7745b25d5ce0a68e4cadc802bb478c59ff35327617c96', array[0,1], array[0,1]),
    ('relay-reachability', 1, 'aaa0857d446419b3ad294fe8e3582cfcc6e3b74f1455e5c8435f73f6cae5bd3c', array[0,1], array[0,1]),
    ('merge-maintenance-windows', 1, '1d057f6c1ba9f66acdb8a6a67a22fd2c2c8124416432086b16a45f10ffba28ff', array[0,1], array[0,1]),
    ('dominant-sensor-code', 1, 'ec8cdb7cb079e2ed92ad9a62f3b503d5149bbfe2044009d5a546775c78ef6fd6', array[0,1], array[0,1]),
    ('target-segment-length', 1, '171ac8c92cb01d938857f3c20bf830a08b9bdd1ded23e15dc85fb4dc30a6eead', array[0,1], array[0,1]),
    ('elevation-gain', 1, 'f95e3541637f1462244690a55d098efb8eb0fc3d5b8f47fc639b5bd4d27e2707', array[0,1], array[0,1]),
    ('signal-islands', 1, 'fdfc546416bb0db78ad28388119480fd9174443dd40ffd4c20924100b7982ae2', array[0,1], array[0,1]),
    ('dependency-order', 1, 'b7aa7b3751201c2c395ce562b11c2498ea5e25e40b48d7172969730f08b41dc0', array[0,1], array[0,1]),
    ('compact-runs', 1, '73eb96569b49a1181f6765eadde475f69ddb45a5f79afec95aa7815d3cfb28ac', array[0,1], array[0,1]),
    ('mirrored-token', 1, '5cf5b3960931a53a7cc4f62d13627f17de8800244dcec26dd5c5613ab276ebcb', array[0,1], array[0,1]),
    ('rotate-shift-queue', 1, '5a5edcb95ceffb1ab971c4e0f4d0f3a3b1cdec002c26e72137169344df94ee87', array[0,1], array[0,1]),
    ('rolling-window-maximum', 1, '2ce82dc6e3cdfb8a5d96fe5240d93497625c8b561ccf2e2e6953ac992bcdd965', array[0,1], array[0,1])
)
update public.problem_judge_configs c
set public_case_plan = jsonb_build_object(
  'format', 'framed-v1', 'fixtureVersion', c.fixture_version,
  'harnessSha256', a.harness_sha256,
  'cases', (select jsonb_agg(jsonb_build_object(
    'id', p.slug || ':' || (m.example_index + 1),
    'fixtureIndex', m.fixture_index,
    'title', p.examples->m.example_index->>'title',
    'input', p.examples->m.example_index->>'input',
    'expected', p.examples->m.example_index->>'output'
  ) order by m.example_index)
  from unnest(a.fixture_indexes, a.example_indexes) as m(fixture_index, example_index))
), updated_at = now()
from public.problems p join approved a on a.slug = p.slug
where c.problem_id = p.id and c.fixture_version = a.version
  and encode(sha256(convert_to(c.harness_source, 'UTF8')), 'hex') = a.harness_sha256
  and not exists (
    select 1 from unnest(a.fixture_indexes, a.example_indexes) as m(fixture_index, example_index)
    where c.expected_output->>m.fixture_index is distinct from p.examples->m.example_index->>'output'
  );
