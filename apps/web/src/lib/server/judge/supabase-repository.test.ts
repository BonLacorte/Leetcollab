import type { SupabaseClient } from "@supabase/supabase-js";
import { judgeQuotaSchema, judgeSubmissionSchema } from "@leetcollab/contracts";
import { describe, expect, it, vi } from "vitest";
import { SupabaseJudgeRepository } from "./supabase-repository";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const problemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const submissionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const period = { start: "2026-11-13T00:00:00Z", end: "2026-11-14T00:00:00Z" };

it("binds normal quota and execution intent to the authenticated actor while peer IDs only describe captured credit", async () => {
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: {
    used: 1, limit: 25, active: 0, resetAt: period.end, result: "reserved", submissionId,
  }, error: null }));
  const repo = new SupabaseJudgeRepository({ rpc } as unknown as SupabaseClient, { userId });
  await repo.getQuota(period, 25);
  expect(rpc).toHaveBeenCalledWith("get_user_judge_quota_status", expect.objectContaining({ p_user_id: userId, p_quota_limit: 25 }));
  await repo.reserve({ userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}",
    period, quotaLimit: 25, activeLimit: 4, reservationSeconds: 45, runner: "onlinecompiler", action: "submit",
    participants: { roomId: "abcdefgh", userIds: [userId, problemId] } });
  expect(rpc).toHaveBeenLastCalledWith("reserve_judge_execution", expect.objectContaining({
    p_scope: "user", p_user_id: userId, p_action: "submit", p_runner: "onlinecompiler", p_participant_ids: [userId, problemId],
  }));
});

it("returns the effective personal quota from the status RPC after provider exhaustion", async () => {
  const rpc = vi.fn(async (name: string, _args: unknown) => ({ data: {
    used: name === "exhaust_judge_quota" ? 20 : 7,
    limit: name === "exhaust_judge_quota" ? 20 : 25,
    active: 0, resetAt: period.end, admission: "exhausted",
  }, error: null }));
  const repo = new SupabaseJudgeRepository({ rpc } as unknown as SupabaseClient, { userId });
  expect(await repo.exhaust(period, 50)).toEqual({
    used: 7, limit: 25, active: 0, remaining: 18, resetAt: "2026-11-14T00:00:00.000Z",
  });
  expect(rpc.mock.calls).toEqual([
    ["exhaust_judge_quota", { p_period_start: period.start }],
    ["get_user_judge_quota_status", {
      p_user_id: userId, p_period_start: period.start, p_period_end: period.end, p_quota_limit: 50,
    }],
  ]);
});

function repository(completionResult = "completed") {
  const rpc = vi.fn(async (name: string) => ({ data: {
    used: 1, limit: 20, active: 0, resetAt: "2026-11-14T00:00:00+00:00",
    result: name === "complete_judge_submission" ? completionResult : "reserved", submissionId,
  }, error: null }));
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
    expect(completion.applied).toBe(true);
    const reservation = await repo.reserve({
      userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}",
      action: "run", period, quotaLimit: 20, activeLimit: 2, reservationSeconds: 45,
    });
    for (const quota of [await repo.getQuota(period, 20), reservation.quota,
      completion.quota, await repo.exhaust(period, 20)]) {
      expect(judgeQuotaSchema.parse(quota).resetAt).toBe("2026-11-14T00:00:00.000Z");
    }
    expect(judgeSubmissionSchema.parse(completion.submission).createdAt)
      .toBe("2026-11-13T23:55:00.000Z");
  });

  it("distinguishes an existing completion from a newly applied outcome", async () => {
    const completion = await repository("existing").complete({
      userId, submissionId, judgeState: "completed", verdict: "wrong_answer",
      testsPassed: 0, testsTotal: 1, durationMs: 10, diagnostics: "",
      providerCpuTime: null, providerMemory: null,
    });
    expect(completion.applied).toBe(false);
    expect(completion.submission.verdict).toBe("accepted");
  });

  it("normalizes timestamps when loading an existing submission", async () => {
    const stored = await repository().getSubmission(userId, submissionId);
    expect(judgeSubmissionSchema.parse(stored).createdAt).toBe("2026-11-13T23:55:00.000Z");
  });
});

describe("server-owned Render RPC binding", () => {
  it("uses private admission and lifecycle RPCs with the durable identity and authenticated owner", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      result: "reserved", submissionId, used: 1, limit: 9, active: 1, resetAt: period.end,
    }, error: null });
    const repo = new SupabaseJudgeRepository({ rpc } as unknown as SupabaseClient);
    const provenance = { provider: "render" as const, workspaceId: "fixture", groupId: "fixture", imageId: "fixture", toolchain: "synthetic JDK" };
    const result = await repo.reserve({
      userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}",
      action: "run", period, quotaLimit: 20, activeLimit: 4, reservationSeconds: 45,
      render: { policyId: "reviewed-fixture", provenance },
    });
    expect(rpc.mock.calls[0]).toEqual(["reserve_render_submission", {
      p_user_id: userId, p_problem_id: problemId, p_idempotency_key: submissionId,
      p_source_code: "class Solution {}", p_policy_id: "reviewed-fixture", p_provenance: provenance,
    }]);
    expect(result.result).toBe("reserved");
    if (result.result !== "reserved") throw new Error("Expected an admitted attempt");
    expect(result.attempt?.id).toBe(submissionId);
    await result.attempt!.begin();
    await result.attempt!.acknowledge("sbx-fixture");
    await result.attempt!.cleanupAcknowledged("sbx-fixture");
    expect(rpc.mock.calls.slice(1)).toEqual(["creating", "acknowledged", "settled"].map((phase) => ["record_render_attempt", {
      p_user_id: userId, p_submission_id: submissionId, p_phase: phase,
      p_resource_id: phase === "creating" ? null : "sbx-fixture",
    }]));
    await repo.getQuota(period, 20, "reviewed-fixture");
    expect(rpc).toHaveBeenLastCalledWith("get_render_quota_status", { p_policy_id: "reviewed-fixture" });
  });
  it("does not hand out execution authority on a duplicate or admission failure", async () => {
    const rpc = vi.fn();
    const repo = new SupabaseJudgeRepository({ rpc } as unknown as SupabaseClient);
    for (const result of ["existing", "in_progress", "busy", "exhausted"]) {
      rpc.mockResolvedValue({ data: { result, submissionId, used: 1, limit: 9, active: 1, resetAt: period.end }, error: null });
      const reservation = await repo.reserve({
        userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}", action: "run", period,
        quotaLimit: 20, activeLimit: 4, reservationSeconds: 45,
        render: { policyId: "synthetic", provenance: { provider: "render", workspaceId: "fixture", groupId: "fixture", imageId: "fixture", toolchain: "synthetic" } },
      });
      expect(reservation).not.toHaveProperty("attempt");
    }
  });
});

describe("server-owned OnlineCompiler reservation binding", () => {
  it.each([
    [undefined, "reserve_judge_submission"],
    ["onlinecompiler", "reserve_onlinecompiler_submission"],
  ] as const)("binds runner %s to its trusted quota RPC", async (runner, name) => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      result: "reserved", submissionId, used: 1, limit: 20, active: 1,
      resetAt: period.end,
    }, error: null });
    const repo = new SupabaseJudgeRepository({ rpc } as unknown as SupabaseClient);
    const result = await repo.reserve({
      userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}",
      action: "run", period, quotaLimit: 20, activeLimit: 4, reservationSeconds: 45, runner,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(name, {
      p_user_id: userId, p_problem_id: problemId, p_idempotency_key: submissionId,
      p_language: "java", p_source_code: "class Solution {}",
      p_period_start: period.start, p_period_end: period.end, p_quota_limit: 20,
      p_active_limit: 4, p_reservation_seconds: 45,
    });
    expect(result).toMatchObject({ result: "reserved", submissionId,
      quota: { used: 1, active: 1, remaining: 19 } });
    expect(result).not.toHaveProperty("attempt");
  });

  it("does not retry or fall back after a runner-bound reservation refusal", async () => {
    const refusal = new Error("idempotency key belongs to another judge runner");
    const rpc = vi.fn().mockResolvedValue({ data: null, error: refusal });
    const repo = new SupabaseJudgeRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.reserve({
      userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}",
      action: "run", period, quotaLimit: 20, activeLimit: 4, reservationSeconds: 45,
      runner: "onlinecompiler",
    })).rejects.toBe(refusal);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects mixed Render and OnlineCompiler execution authority before a reservation", async () => {
    const rpc = vi.fn();
    const repo = new SupabaseJudgeRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.reserve({
      userId, problemId, idempotencyKey: submissionId, sourceCode: "class Solution {}",
      action: "run", period, quotaLimit: 20, activeLimit: 4, reservationSeconds: 45,
      runner: "onlinecompiler",
      render: { policyId: "synthetic", provenance: {
        provider: "render", workspaceId: "fixture", groupId: "fixture",
        imageId: "fixture", toolchain: "synthetic",
      } },
    })).rejects.toThrow("Invalid server-owned judge runner selection.");
    expect(rpc).not.toHaveBeenCalled();
  });
});
