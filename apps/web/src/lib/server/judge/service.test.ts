import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { JudgeQuota, JudgeSubmissionRequest, JudgeVerdict } from "@leetcollab/contracts";
import { JudgeService } from "./service";
import type {
  ExecutionProvider,
  JudgeCompletion,
  JudgeConfig,
  JudgeRepository,
  QuotaPeriod,
  Reservation,
  StoredSubmission,
} from "./types";

const problemId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-10T12:00:00.000Z");
const sourceCode = "class Solution { public static int answer() { return 42; } }";

class MemoryRepository implements JudgeRepository {
  used = 0;
  active = 0;
  limit = 20;
  readonly submissions = new Map<string, StoredSubmission & { owner: string }>();
  private readonly keys = new Map<string, string>();

  constructor(readonly config: JudgeConfig) {}

  quota(resetAt = "2026-11-10T23:55:00.000Z"): JudgeQuota {
    return { used: this.used, limit: this.limit, remaining: this.limit - this.used, active: this.active, resetAt };
  }

  async getConfig(id: string) {
    return id === this.config.problemId ? this.config : null;
  }

  async getQuota(period: QuotaPeriod, limit: number) {
    this.limit = Math.min(this.limit, limit);
    return this.quota(period.end);
  }

  async reserve(input: Parameters<JudgeRepository["reserve"]>[0]): Promise<Reservation> {
    this.limit = Math.min(this.limit, input.quotaLimit);
    if (input.problemId !== this.config.problemId) return { result: "problem_not_found", quota: this.quota(input.period.end) };
    const key = `${input.userId}:${input.idempotencyKey}`;
    const existingId = this.keys.get(key);
    if (existingId) {
      const existing = this.submissions.get(existingId)!;
      return {
        result: existing.judgeState === "reserved" ? "in_progress" : "existing",
        submissionId: existingId,
        quota: this.quota(input.period.end),
      };
    }
    if (this.used >= this.limit) return { result: "exhausted", quota: this.quota(input.period.end) };
    if (this.active >= input.activeLimit) return { result: "busy", quota: this.quota(input.period.end) };

    const id = randomUUID();
    this.used += 1;
    this.active += 1;
    this.keys.set(key, id);
    this.submissions.set(id, {
      id,
      owner: input.userId,
      problemId: input.problemId,
      language: "java",
      verdict: "runtime_error",
      verification: "leetcollab",
      testsPassed: 0,
      testsTotal: 0,
      durationMs: null,
      diagnostics: null,
      createdAt: now.toISOString(),
      judgeState: "reserved",
    });
    return { result: "reserved", submissionId: id, quota: this.quota(input.period.end) };
  }

  async getSubmission(userId: string, submissionId: string) {
    const stored = this.submissions.get(submissionId);
    return stored?.owner === userId ? stored : null;
  }

  async complete(value: JudgeCompletion) {
    const stored = this.submissions.get(value.submissionId);
    if (!stored || stored.owner !== value.userId) throw new Error("cross-user completion denied");
    if (stored.judgeState === "reserved") this.active -= 1;
    Object.assign(stored, {
      judgeState: value.judgeState,
      verdict: value.verdict,
      testsPassed: value.testsPassed,
      testsTotal: value.testsTotal,
      durationMs: value.durationMs,
      diagnostics: value.diagnostics,
    });
    return { submission: stored, quota: this.quota() };
  }

  async exhaust() {
    this.used = this.limit;
    return this.quota();
  }
}

class OutputProvider implements ExecutionProvider {
  readonly configured = true;
  calls = 0;
  constructor(private readonly output = "42\n") {}
  async execute() {
    this.calls += 1;
    return { kind: "completed" as const, output: this.output, durationMs: 8, cpuTime: null, memory: null };
  }
}

function config(fallback: JudgeConfig["fallback"] = null): JudgeConfig {
  return {
    problemId,
    fixtureVersion: 1,
    harnessSource: "class Main { public static void main(String[] args) {} }",
    expectedOutput: ["42"],
    fallback,
  };
}

function request(key = randomUUID()): JudgeSubmissionRequest {
  return { problemId, language: "java", sourceCode, idempotencyKey: key };
}

describe("JudgeService", () => {
  it("returns a LeetCollab-verified verdict from owned output comparison", async () => {
    const repository = new MemoryRepository(config());
    const result = await new JudgeService(repository, new OutputProvider(), { now: () => now }).submit("user-a", request());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      submission: { verdict: "accepted", verification: "leetcollab", testsPassed: 1, testsTotal: 1 },
      quota: { used: 1, remaining: 19 },
    });
  });

  it("does not spend more than the shared limit under concurrent requests", async () => {
    const repository = new MemoryRepository(config());
    const provider = new OutputProvider();
    const service = new JudgeService(repository, provider, { quotaLimit: 20, activeLimit: 20, now: () => now });
    const results = await Promise.all(Array.from({ length: 30 }, (_, index) => service.submit(`user-${index}`, request())));

    expect(repository.used).toBe(20);
    expect(provider.calls).toBe(20);
    expect(results.filter((result) => result.body.ok).length).toBe(20);
    expect(results.filter((result) => !result.body.ok && result.body.error.code === "QUOTA_EXHAUSTED").length).toBe(10);
  });

  it("deduplicates a retry without a second provider call", async () => {
    const repository = new MemoryRepository(config());
    const provider = new OutputProvider();
    const service = new JudgeService(repository, provider, { now: () => now });
    const idempotencyKey = randomUUID();
    const first = await service.submit("user-a", request(idempotencyKey));
    const second = await service.submit("user-a", request(idempotencyKey));
    expect(first.body).toEqual(second.body);
    expect(provider.calls).toBe(1);
    expect(repository.used).toBe(1);
  });

  it("keeps submissions private to their owner", async () => {
    const repository = new MemoryRepository(config());
    const service = new JudgeService(repository, new OutputProvider(), { now: () => now });
    const result = await service.submit("user-a", request());
    if (!result.body.ok) throw new Error("expected accepted submission");
    await expect(repository.getSubmission("user-b", result.body.submission.id)).resolves.toBeNull();
    await expect(repository.getSubmission("user-a", result.body.submission.id)).resolves.toMatchObject({ owner: "user-a" });
  });

  it("offers only a curated fallback after exhaustion", async () => {
    const eligible = { name: "Source judge", url: "https://judge.example/problem", verification: "external_self_reported" as const };
    const repository = new MemoryRepository(config(eligible));
    repository.limit = 1;
    const service = new JudgeService(repository, new OutputProvider(), { quotaLimit: 1, now: () => now });
    await service.submit("user-a", request());
    const exhausted = await service.submit("user-b", request());
    expect(exhausted.body).toMatchObject({ ok: false, error: { code: "QUOTA_EXHAUSTED" }, fallback: eligible });

    const originalRepository = new MemoryRepository(config(null));
    originalRepository.limit = 1;
    const originalService = new JudgeService(originalRepository, new OutputProvider(), { quotaLimit: 1, now: () => now });
    await originalService.submit("user-a", request());
    const unavailable = await originalService.submit("user-b", request());
    expect(unavailable.body).toMatchObject({ ok: false, fallback: null });
  });

  it("reports unconfigured execution without reserving quota", async () => {
    const repository = new MemoryRepository(config());
    const provider: ExecutionProvider = {
      configured: false,
      execute: async () => { throw new Error("must not execute"); },
    };
    const result = await new JudgeService(repository, provider, { now: () => now }).submit("user-a", request());
    expect(result.body).toMatchObject({ ok: false, error: { code: "JUDGE_UNAVAILABLE" }, quota: { used: 0 } });
    expect(repository.used).toBe(0);
  });

  it("distinguishes incorrect output from sandbox failures", async () => {
    const repository = new MemoryRepository(config());
    const result = await new JudgeService(repository, new OutputProvider("41\n"), { now: () => now }).submit("user-a", request());
    expect(result.body).toMatchObject({ ok: true, submission: { verdict: "wrong_answer" satisfies JudgeVerdict } });
  });
});

// Oracle: JDoodle credits reset daily at 23:55 UTC.
it("uses the provider reset boundary rather than UTC midnight", async () => {
  const { quotaPeriod } = await import("./service");
  expect(quotaPeriod(new Date("2026-11-11T23:54:59Z"))).toEqual({
    start: "2026-11-10T23:55:00.000Z", end: "2026-11-11T23:55:00.000Z",
  });
  expect(quotaPeriod(new Date("2026-11-11T23:55:00Z"))).toEqual({
    start: "2026-11-11T23:55:00.000Z", end: "2026-11-12T23:55:00.000Z",
  });
});
