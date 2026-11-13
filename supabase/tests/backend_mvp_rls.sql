begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'alpha@example.test', '', now(), now(), '{}'::jsonb, '{"username":"alpha"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'bravo@example.test', '', now(), now(), '{}'::jsonb, '{"username":"bravo"}'::jsonb);

insert into public.user_problem_progress (user_id, problem_id, review_grade, suggested_review_at)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'hard', now() + interval '3 days'
from public.problems where slug = 'parcel-pair';

insert into public.problem_review_attempts (user_id, problem_id, grade, suggested_review_at)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'hard', now() + interval '3 days'
from public.problems where slug = 'parcel-pair';

insert into public.submissions (
  user_id, problem_id, language, source_code, status, judge_state, verdict,
  verification, tests_passed, tests_total
)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'java', 'class Solution {}',
       'accepted', 'completed', 'accepted', 'leetcollab', 1, 1
from public.problems where slug = 'parcel-pair';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  'select count(*) from public.user_problem_progress',
  'values (0::bigint)',
  'another user cannot read private progress'
);
select results_eq(
  'select count(*) from public.problem_review_attempts',
  'values (0::bigint)',
  'another user cannot read private grades and review dates'
);
select results_eq(
  'select count(*) from public.submissions',
  'values (0::bigint)',
  'another user cannot read private submissions'
);
select throws_ok(
  $$select count(*) from public.problem_judge_configs$$,
  '42501',
  null,
  'browser roles cannot read private fixtures'
);
select throws_ok(
  $$select count(*) from public.judge_quota_periods$$,
  '42501',
  null,
  'browser roles cannot read shared quota internals'
);
select throws_ok(
  $$select public.reserve_judge_submission(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      (select id from public.problems where slug = 'parcel-pair'),
      gen_random_uuid(), 'java', 'class Solution {}',
      date_trunc('day', now()), date_trunc('day', now()) + interval '1 day',
      20, 4, 45
    )$$,
  '42501',
  null,
  'browser roles cannot reserve shared quota'
);

select lives_ok(
  $$select * from public.record_problem_grade(
      (select id from public.problems where slug = 'parcel-pair'), 'easy'
    )$$,
  'second user can record an independent grade'
);
select results_eq(
  $$select review_grade from public.user_problem_progress
    where problem_id = (select id from public.problems where slug = 'parcel-pair')$$,
  $$values ('easy'::text)$$,
  'second user sees only their own grade'
);

select throws_ok(
  $$insert into public.user_problem_progress(user_id,problem_id)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id from public.problems where slug='bracket-beacon'$$,
  '42501', null, 'another user cannot write private progress'
);
select throws_ok(
  $$insert into public.submissions(user_id,problem_id,language,source_code,status)
    select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id, 'java', 'class Solution {}', 'accepted'
    from public.problems where slug='parcel-pair'$$,
  '42501', null, 'browser cannot forge a verified submission'
);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok(
  $$select * from public.record_problem_grade(
      (select id from public.problems where slug = 'parcel-pair'), 'hard'
    )$$,
  'first user can record a separate grade'
);
select results_eq('select count(*) from public.user_problem_progress', 'values (1::bigint)', 'owner can read progress');
select results_eq('select count(*) from public.problem_review_attempts', 'values (2::bigint)', 'owner can read their review attempt history');
select results_eq('select count(*) from public.submissions', 'values (1::bigint)', 'owner can read submissions');

reset role;
select is(
  (select review_grade from public.user_problem_progress where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'hard',
  'first user grade is independent'
);
select is(
  (select review_grade from public.user_problem_progress where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'easy',
  'second user grade is independent'
);
select is(
  (select suggested_review_at - last_reviewed_at from public.user_problem_progress where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  interval '3 days',
  'hard grade receives the documented three-day suggestion'
);
select is(
  (select suggested_review_at - last_reviewed_at from public.user_problem_progress where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  interval '14 days',
  'easy grade receives the documented fourteen-day suggestion'
);

select * from finish();
rollback;
