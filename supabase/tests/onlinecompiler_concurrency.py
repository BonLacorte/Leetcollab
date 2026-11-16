"""Runner-binding races, only against an owned disposable PostgreSQL database.

Apply all migrations first. Uses the same explicit disposable DB selectors as the
existing quota tests and never starts or changes a container itself.
"""
import concurrent.futures
import datetime
import json
import os
import subprocess
import threading
import unittest
import uuid


class RunnerReservationConcurrencyTest(unittest.TestCase):
    command = ["docker", "exec", os.environ["TEST_POSTGRES_CONTAINER"], "psql", "-U", "postgres",
               "-d", os.environ["TEST_DATABASE_NAME"], "-Atq", "-v", "ON_ERROR_STOP=1", "-c"]

    def query(self, sql):
        result = subprocess.run(self.command + [sql], text=True, capture_output=True)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def setUp(self):
        self.user = str(uuid.uuid4())
        self.key = str(uuid.uuid4())
        self.problem = self.query("select id from public.problems where slug='parcel-pair'")
        start = datetime.datetime(2193, 1, 1, tzinfo=datetime.timezone.utc)
        start += datetime.timedelta(seconds=uuid.uuid4().int % 1000000000)
        self.start = start.isoformat()
        self.end = (start + datetime.timedelta(days=1)).isoformat()
        self.query(f"insert into auth.users(id,email,raw_user_meta_data) values "
                   f"('{self.user}','{self.user}@example.test','{{}}')")

    def tearDown(self):
        self.query(f"delete from auth.users where id='{self.user}'")
        self.query(f"delete from public.judge_quota_periods where period_start='{self.start}'")

    def reserve(self, runner, barrier):
        name = {"jdoodle": "reserve_judge_submission",
                "onlinecompiler": "reserve_onlinecompiler_submission"}[runner]
        barrier.wait()
        result = subprocess.run(self.command + [
            f"select public.{name}('{self.user}','{self.problem}','{self.key}',"
            f"'java','class Solution {{}}','{self.start}','{self.end}',20,4,45)"
        ], text=True, capture_output=True)
        return runner, result

    def test_competing_providers_reserve_once_without_relabeling(self):
        barrier = threading.Barrier(2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda runner: self.reserve(runner, barrier),
                                    ["jdoodle", "onlinecompiler"]))
        winners = [(runner, result) for runner, result in results if result.returncode == 0]
        losers = [(runner, result) for runner, result in results if result.returncode != 0]
        self.assertEqual(len(winners), 1, results)
        self.assertEqual(len(losers), 1, results)
        winner, result = winners[0]
        self.assertEqual(json.loads(result.stdout)["result"], "reserved")
        self.assertIn("idempotency key belongs to another judge runner", losers[0][1].stderr)
        row = json.loads(self.query("select row_to_json(t) from (select runner,judge_state "
                                   f"from public.submissions where user_id='{self.user}') t"))
        self.assertEqual(row, {"runner": winner, "judge_state": "reserved"})
        self.assertEqual(self.query("select used::text || ',' || active::text from "
                                    f"public.judge_quota_periods where period_start='{self.start}'"), "1,1")

    def test_onlinecompiler_duplicate_returns_one_durable_attempt(self):
        barrier = threading.Barrier(2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.reserve("onlinecompiler", barrier), range(2)))
        bodies = []
        for _, result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
            bodies.append(json.loads(result.stdout))
        self.assertEqual(sorted(body["result"] for body in bodies), ["in_progress", "reserved"])
        self.assertEqual(len({body["submissionId"] for body in bodies}), 1)
        self.assertEqual({body["used"] for body in bodies}, {1})
        self.assertEqual(self.query(f"select runner from public.submissions where user_id='{self.user}'"),
                         "onlinecompiler")


if __name__ == "__main__":
    unittest.main()
