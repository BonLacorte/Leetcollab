"""Offline Render admission regressions, ONLY against an owned disposable DB.

Apply all migrations first. Set TEST_POSTGRES_CONTAINER and TEST_DATABASE_NAME.
All limits, identity and cost numbers below are synthetic fixtures, not live policy.
Uses the real PostgreSQL RPCs and concurrent independent client transactions.
"""
import concurrent.futures
import json
import os
import subprocess
import unittest
import uuid


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


class RenderAdmissionTest(unittest.TestCase):
    command = ["docker", "exec", os.environ["TEST_POSTGRES_CONTAINER"], "psql", "-U", "postgres",
               "-d", os.environ["TEST_DATABASE_NAME"], "-Atq", "-v", "ON_ERROR_STOP=1", "-c"]
    provenance = {"provider": "render", "workspaceId": "tea-00000000000000000000",
                  "groupId": "sbg-00000000000000000000", "imageId": "sbb-00000000000000000000",
                  "toolchain": "synthetic-pinned-jdk-21"}

    def query(self, sql):
        result = subprocess.run(self.command + [sql], text=True, capture_output=True)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def rejected(self, sql, message=None):
        result = subprocess.run(self.command + [sql], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        if message:
            self.assertIn(message, result.stderr)

    def setUp(self):
        self.query("truncate public.render_reconciliation_evidence, public.render_execution_attempts, "
                   "public.render_admission_policy;")
        self.users = [str(uuid.uuid4()), str(uuid.uuid4())]
        for user in self.users:
            self.query(f"insert into auth.users(id,email,raw_user_meta_data) values "
                       f"('{user}','{user}@example.test','{{}}');")
        self.policy = str(uuid.uuid4())
        self.problem = self.query("select id from public.problems where slug='parcel-pair'")
        self.other_problem = self.query("select id from public.problems where slug='bracket-beacon'")
        self.query("insert into public.render_admission_policy values (true,"
                   f"'{self.policy}','synthetic-review-only',now()+interval '1 day',"
                   "'tea-00000000000000000000','sbg-00000000000000000000',"
                   "'sbb-00000000000000000000','synthetic-pinned-jdk-21',20,100,2,7,700);")

    def tearDown(self):
        self.query("truncate public.render_reconciliation_evidence, public.render_execution_attempts, "
                   "public.render_admission_policy;")
        for user in self.users:
            self.query(f"delete from auth.users where id='{user}';")

    def reserve_sql(self, user=None, key=None, source="class Solution {}", problem=None, provenance=None):
        return ("select public.reserve_render_submission("
                f"'{user or self.users[0]}','{problem or self.problem}','{key or uuid.uuid4()}',"
                f"{literal(source)},'{self.policy}',{literal(json.dumps(provenance or self.provenance))}::jsonb)")

    def reserve(self, **kwargs):
        return json.loads(self.query(self.reserve_sql(**kwargs)))

    def transition(self, attempt, phase, resource=None, user=None):
        self.query("select public.record_render_attempt("
                   f"'{user or self.users[0]}','{attempt}','{phase}',"
                   f"{literal(resource) if resource else 'null'})")

    def complete_sql(self, attempt, state="failed", verdict="runtime_error", user=None):
        return ("select public.complete_judge_submission("
                f"'{user or self.users[0]}','{attempt}','{state}','{verdict}',"
                f"{1 if verdict == 'accepted' else 0},1,10,'synthetic result',null,null)")

    def test_provenance_and_duplicate_binding_are_durable(self):
        key = str(uuid.uuid4())
        first = self.reserve(key=key)
        attempt = first["submissionId"]
        duplicate = self.reserve(key=key)
        self.assertEqual(duplicate["submissionId"], attempt)
        self.assertEqual(duplicate["result"], "in_progress")
        row = json.loads(self.query("select row_to_json(t) from (select s.runner,a.* from "
                                   "public.submissions s join public.render_execution_attempts a "
                                   f"on a.submission_id=s.id where s.id='{attempt}') t"))
        self.assertEqual(row["runner"], "render")
        self.assertEqual(row["provenance"], self.provenance)
        self.assertEqual(row["policy_id"], self.policy)
        self.assertEqual(row["reserved_cost_microusd"], 7)
        for kwargs in [{"source": "different"}, {"problem": self.other_problem},
                       {"provenance": {**self.provenance, "imageId": "sbb-11111111111111111111"}}]:
            self.rejected(self.reserve_sql(key=key, **kwargs))
        self.assertEqual(self.query("select count(*) from public.render_execution_attempts"), "1")
        self.query(self.complete_sql(attempt))
        self.assertEqual(self.reserve(key=key)["result"], "existing")
        self.assertEqual(self.reserve(key=key)["used"], 1)

    def test_concurrent_duplicate_creates_one_attempt(self):
        key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.reserve(key=key), range(2)))
        self.assertEqual(sorted(r["result"] for r in results), ["in_progress", "reserved"])
        self.assertEqual(len({r["submissionId"] for r in results}), 1)
        self.assertEqual(self.query("select sum(reserved_cost_microusd) from public.render_execution_attempts"), "7")

    def test_concurrent_last_day_month_budget_and_active_reservation(self):
        for configuration, denied in [("daily_limit=1", "exhausted"), ("monthly_limit=1", "exhausted"),
                                       ("monthly_budget_microusd=13", "exhausted"), ("active_limit=1", "busy")]:
            with self.subTest(configuration=configuration):
                self.query("truncate public.render_reconciliation_evidence, public.render_execution_attempts;")
                self.query("update public.render_admission_policy set daily_limit=20, monthly_limit=100, "
                           "monthly_budget_microusd=700, active_limit=2")
                self.query("update public.render_admission_policy set " + configuration)
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                    results = list(pool.map(lambda user: self.reserve(user=user), self.users))
                self.assertEqual(sorted(r["result"] for r in results), sorted([denied, "reserved"]))
                self.assertEqual(self.query("select count(*) from public.render_execution_attempts"), "1")
                admission = json.loads(self.query(f"select public.get_render_quota_status('{self.policy}')"))["admission"]
                self.assertEqual(admission, "busy" if denied == "busy" else "exhausted")

    def test_ambiguity_keeps_usage_and_blocks_overlap_across_periods_and_revisions(self):
        key = str(uuid.uuid4())
        attempt = self.reserve(key=key)["submissionId"]
        self.transition(attempt, "creating")
        self.assertEqual(self.reserve(user=self.users[1])["result"], "busy")
        self.rejected(f"select public.record_render_attempt('{self.users[0]}','{attempt}','creating',null)")
        self.query(self.complete_sql(attempt))
        self.assertEqual(self.query(f"select phase from public.render_execution_attempts where submission_id='{attempt}'"), "unknown")
        self.assertEqual(self.reserve(key=key)["result"], "existing")
        self.assertEqual(self.reserve()["result"], "busy")
        self.assertEqual(self.reserve()["used"], 1)
        self.transition(attempt, "acknowledged", "sbx-1")  # late ID does not resolve ambiguity
        self.rejected(f"select public.record_render_attempt('{self.users[0]}','{attempt}','settled','sbx-1')")
        self.query("update public.render_execution_attempts set admitted_at=now()-interval '40 days'")
        self.policy = str(uuid.uuid4())
        self.query(f"update public.render_admission_policy set policy_id='{self.policy}'")
        later = self.reserve()
        self.assertEqual(later["result"], "busy")
        self.assertEqual(later["active"], 1)
        self.assertEqual(self.query("select sum(reserved_cost_microusd) from public.render_execution_attempts"), "7")

    def test_operator_evidence_is_required_and_never_refunds(self):
        attempt = self.reserve()["submissionId"]
        self.transition(attempt, "creating")
        self.query(self.complete_sql(attempt))
        evidence = str(uuid.uuid4())
        self.rejected(f"select public.reconcile_render_attempt('{attempt}','{evidence}')", "prior operator")
        self.rejected("set role service_role; insert into public.render_reconciliation_evidence values "
                      f"('{evidence}','{attempt}','forged','forged','{{}}',now(),now())", "permission denied")
        self.query("insert into public.render_reconciliation_evidence values "
                   f"('{evidence}','{attempt}','synthetic operator','synthetic external terminal proof','{{}}',"
                   "clock_timestamp(),clock_timestamp())")
        self.query(f"set role service_role; select public.reconcile_render_attempt('{attempt}','{evidence}')")
        self.query(f"select public.reconcile_render_attempt('{attempt}','{evidence}')")
        quota = json.loads(self.query(f"select public.get_render_quota_status('{self.policy}')"))
        self.assertEqual((quota["used"], quota["active"]), (1, 0))
        self.assertEqual(self.reserve()["result"], "reserved")
        self.assertEqual(self.query("select sum(reserved_cost_microusd) from public.render_execution_attempts"), "14")

    def test_cleanup_completion_ownership_and_server_only_privileges(self):
        attempt = self.reserve()["submissionId"]
        self.rejected(self.complete_sql(attempt, "completed", "accepted"), "cleanup evidence")
        self.rejected(f"select public.record_render_attempt('{self.users[1]}','{attempt}','creating',null)", "attempt not found")
        self.transition(attempt, "creating")
        self.transition(attempt, "acknowledged", "sbx-1")
        self.rejected(f"select public.record_render_attempt('{self.users[0]}','{attempt}','acknowledged','sbx-2')")
        self.transition(attempt, "settled", "sbx-1")
        self.query(self.complete_sql(attempt, "completed", "accepted"))
        # Completion replay cannot replace trusted comparison or release capacity twice.
        self.query(self.complete_sql(attempt))
        self.assertEqual(self.query(f"select verdict from public.submissions where id='{attempt}'"), "accepted")
        self.assertEqual(self.reserve()["active"], 1)
        for role in ["anon", "authenticated"]:
            for table in ["render_admission_policy", "render_execution_attempts", "render_reconciliation_evidence", "problem_judge_configs"]:
                self.rejected(f"set role {role}; select * from public.{table}", "permission denied")
            self.rejected(f"set role {role}; " + self.reserve_sql(), "permission denied")
            self.rejected(f"set role {role}; " + self.complete_sql(attempt), "permission denied")
            self.rejected(f"set role {role}; select public.reconcile_render_attempt('{attempt}','{uuid.uuid4()}')", "permission denied")
        self.assertEqual(self.query("set role authenticated; "
                                   f"select set_config('request.jwt.claim.sub','{self.users[1]}',false); "
                                   f"select count(*) from public.submissions where id='{attempt}'").splitlines()[-1], "0")

    def test_reconciliation_requires_known_resource_coverage(self):
        attempt = self.reserve()["submissionId"]
        self.transition(attempt, "creating")
        self.transition(attempt, "acknowledged", "sbx-1")
        self.query(self.complete_sql(attempt))
        evidence = str(uuid.uuid4())
        self.query("insert into public.render_reconciliation_evidence values "
                   f"('{evidence}','{attempt}','synthetic operator','synthetic proof','{{}}',"
                   "clock_timestamp(),clock_timestamp())")
        self.rejected(f"select public.reconcile_render_attempt('{attempt}','{evidence}')", "prior operator")
        self.query(f"update public.render_reconciliation_evidence set resource_ids=array['sbx-1'] where id='{evidence}'")
        self.query(f"select public.reconcile_render_attempt('{attempt}','{evidence}')")
        self.assertEqual(self.query("select phase from public.render_execution_attempts"), "settled")

    def test_missing_expired_null_and_unknown_policy_cost_fail_closed(self):
        self.rejected("update public.render_admission_policy set attempt_cost_microusd=null")
        self.rejected("update public.render_admission_policy set attempt_cost_microusd=0")
        self.rejected("update public.render_admission_policy set monthly_budget_microusd=0")
        self.query("update public.render_admission_policy set valid_until=now()-interval '1 second'")
        self.rejected(self.reserve_sql(), "reviewed Render policy required")
        self.assertEqual(self.query("select count(*) from public.render_execution_attempts"), "0")
        self.query("delete from public.render_admission_policy")
        self.rejected(self.reserve_sql(), "reviewed Render policy required")


if __name__ == "__main__":
    unittest.main()
