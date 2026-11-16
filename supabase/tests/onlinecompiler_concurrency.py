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

    def test_evaluation_two_remaining_slots_preserve_baseline_under_races(self):
        # Independent oracle: used 7 + TWO approved slots = 9, concurrency one.
        # Fixed UTC period avoids wall-clock reset/lease timing dependencies.
        self.start = "2194-01-01T23:55:00+00:00"
        self.end = "2194-01-02T23:55:00+00:00"
        self.query("insert into public.judge_quota_periods "
                   "(period_start,period_end,used,quota_limit,active) values "
                   f"('{self.start}','{self.end}',7,20,0)")

        def race(round_number):
            barrier = threading.Barrier(8)

            def request(index):
                # Fixed, distinct keys in each wave; duplicates tested below.
                key = str(uuid.UUID(int=round_number * 100 + index + 1))
                barrier.wait()
                return json.loads(self.query(
                    "select public.reserve_onlinecompiler_submission("
                    f"'{self.user}','{self.problem}','{key}','java','class Solution {{}}',"
                    f"'{self.start}','{self.end}',9,1,45)"))

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                return list(pool.map(request, range(8)))

        first = race(1)
        self.assertEqual(sorted(r["result"] for r in first), ["busy"] * 7 + ["reserved"])
        first_id = next(r["submissionId"] for r in first if r["result"] == "reserved")
        self.assertEqual(self.query("select used::text || ',' || quota_limit::text || ',' || active::text "
                                    "from public.judge_quota_periods "
                                    f"where period_start='{self.start}'"), "8,9,1")
        self.query(f"select public.complete_judge_submission('{self.user}','{first_id}',"
                   "'completed','wrong_answer',0,3,1,'synthetic',null,null)")
        second = race(2)
        self.assertEqual(sorted(r["result"] for r in second), ["exhausted"] * 7 + ["reserved"])
        second_id = next(r["submissionId"] for r in second if r["result"] == "reserved")
        self.query(f"select public.complete_judge_submission('{self.user}','{second_id}',"
                   "'failed','runtime_error',0,3,0,'synthetic retained charge',null,null)")
        # Completed and failed duplicate keys remain charged and never re-execute.
        keys = self.query("select string_agg(idempotency_key::text,',') from public.submissions "
                          f"where user_id='{self.user}'").split(',')
        for key in keys:
            replay = json.loads(self.query("select public.reserve_onlinecompiler_submission("
                f"'{self.user}','{self.problem}','{key}','java','class Solution {{}}',"
                f"'{self.start}','{self.end}',9,1,45)"))
            self.assertEqual(replay["result"], "existing")
            self.assertEqual(replay["used"], 9)
        self.assertEqual({r["result"] for r in race(3)}, {"exhausted"})
        self.assertEqual(self.query("select used::text || ',' || quota_limit::text || ',' || active::text "
                                    "from public.judge_quota_periods "
                                    f"where period_start='{self.start}'"), "9,9,0")
        self.assertEqual(self.query(f"select count(*) from public.submissions where user_id='{self.user}'"), "2")


if __name__ == "__main__":
    unittest.main()
