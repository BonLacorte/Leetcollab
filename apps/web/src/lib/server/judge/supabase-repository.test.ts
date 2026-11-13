import type { SupabaseClient } from "@supabase/supabase-js";
import { judgeQuotaSchema, judgeSubmissionSchema } from "@leetcollab/contracts";
import { describe, expect, it, vi } from "vitest";
import { SupabaseJudgeRepository } from "./supabase-repository";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const problemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const submissionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const period = { start: "2026-11-13T00:00:00Z", end: "2026-11-14T00:00:00Z" };

function repository() {
  const rpc = vi.fn().mockResolvedValue({ data: {
    used: 1, limit: 20, active: 0, resetAt: "2026-11-14T00:00:00+00:00",
    result: "reserved", submissionId,
  }, error: null });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: {
      id: submissionId, problem_id: problemId, verdict: "accepted",
      tests_passed: 1, tests_total: 1, duration_ms: 10, diagnostics: null,
      created_at: "2026-11-13T23:55:00+00:00", judge_state: "completed",
    }, error: null }),
  };
  return new SupabaseJudgeRepository({ rpc, from: () => query } as unknown as SupabaseClient);
}

describe("PostgreSQL timestamps satisfy the public judge response contract", () => {
  it("normalizes quota timestamps for every RPC path", async () => {
    const repo = repository();
    const completion = await repo.complete({
      userId, submissionId, judgeState: "completed", verdict: "accepted",
      testsPassed: 1, testsTotal: 1, durationMs: 10, diagnostics: "",
      providerCpuTime: null, providerMemory: null,
    });
    const reservation = await repo.reserve({
      userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}",
      period, quotaLimit: 20, activeLimit: 2, reservationSeconds: 45,
    });
    for (const quota of [await repo.getQuota(period, 20), reservation.quota,
      completion.quota, await repo.exhaust(period.start)]) {
      expect(judgeQuotaSchema.parse(quota).resetAt).toBe("2026-11-14T00:00:00.000Z");
    }
    expect(judgeSubmissionSchema.parse(completion.submission).createdAt)
      .toBe("2026-11-13T23:55:00.000Z");
  });

  it("normalizes timestamps when loading an existing submission", async () => {
    const stored = await repository().getSubmission(userId, submissionId);
    expect(judgeSubmissionSchema.parse(stored).createdAt).toBe("2026-11-13T23:55:00.000Z");
  });
});
