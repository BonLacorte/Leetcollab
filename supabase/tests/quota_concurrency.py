"""Run only on a disposable database with migrations applied.

TEST_POSTGRES_CONTAINER=<local container> TEST_DATABASE_NAME=<test db> python3 <this file>
Requires docker and the container's psql. No dblink privileges or auth changes needed.
"""
import concurrent.futures
import datetime
import json
import os
import subprocess
import unittest
import uuid


class SharedQuotaTest(unittest.TestCase):
    def test_two_users_cannot_spend_the_last_credit_twice(self):
        container = os.environ["TEST_POSTGRES_CONTAINER"]
        database = os.environ["TEST_DATABASE_NAME"]
        command = ["docker", "exec", container, "psql", "-U", "postgres", "-d", database,
                   "-At", "-v", "ON_ERROR_STOP=1", "-c"]

        def query(sql):
            return subprocess.check_output(command + [sql], text=True).strip()

        users = [str(uuid.uuid4()), str(uuid.uuid4())]
        start = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=36500)
        end = start + datetime.timedelta(days=1)
        try:
            for user in users:
                query(f"insert into auth.users(id,email,raw_user_meta_data) values "
                      f"('{user}','{user}@example.test','{{}}');")

            def reserve(user):
                return json.loads(query(
                    "select public.reserve_judge_submission("
                    f"'{user}',(select id from public.problems where slug='parcel-pair'),"
                    f"'{uuid.uuid4()}','java','class Solution {{}}',"
                    f"'{start.isoformat()}','{end.isoformat()}',1,2,45);"))

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(reserve, users))
            self.assertEqual(sorted(r["result"] for r in results), ["exhausted", "reserved"])
            self.assertEqual(query("select used from public.judge_quota_periods "
                                   f"where period_start='{start.isoformat()}'"), "1")
        finally:
            for user in users:
                query(f"delete from auth.users where id='{user}';")
            query(f"delete from public.judge_quota_periods where period_start='{start.isoformat()}';")


if __name__ == "__main__":
    unittest.main()
