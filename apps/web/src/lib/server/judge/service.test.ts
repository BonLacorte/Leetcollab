import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { JudgeQuota, JudgeSubmissionRequest, JudgeVerdict } from "@leetcollab/contracts";
import { JudgeService } from "./service";
import { OnlineCompilerProvider } from "./onlinecompiler";
import { judgeSubmissionResponseSchema } from "@leetcollab/contracts";
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
  async readQuota() { return null; }
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

  async hasSubmissionKey(userId: string, key: string) {
    return this.keys.has(`${userId}:${key}`);
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
  return { problemId, language: "java", sourceCode, idempotencyKey: key, action: "run" };
}

describe("structured public results", () => {
  const framed = (values: string[]) => values.map((value, index) =>
    `__LEETCOLLAB_CASE_V1__${index}:${Buffer.from(value).toString("base64")}\n`).join("");
  const publicConfig = (): JudgeConfig => ({ ...config(), expectedOutput: ["42", "HIDDEN_EXPECTED"],
    harnessSource: 'class Main { public static void main(String[] args) { System.out.println(Solution.answer()); System.out.println("HIDDEN_EXPECTED"); } }',
    publicCasePlan: { format: "framed-v1", cases: [
      { id: "sample:1", fixtureIndex: 0, title: "Public example", input: "value = 7", expected: "42" },
    ] } });

  it.each([
    ["42", "HIDDEN_EXPECTED", "accepted", 2],
    ["41", "HIDDEN_EXPECTED", "wrong_answer", 1],
    ["42", "HIDDEN_WRONG", "wrong_answer", 1],
  ] as const)("projects actual public output %s with private output withheld", async (actual, hidden, verdict, testsPassed) => {
    const repository = new MemoryRepository(publicConfig());
    const send = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify({
      output: framed([actual, hidden]), error: "", status: "success", exit_code: 0, signal: null, truncated: false,
    })));
    const provider = new OnlineCompilerProvider({ apiKey: "synthetic", executionApproved: true, policyAccepted: true, fetch: send });
    const result = await new JudgeService(repository, provider, { now: () => now }).submit("user-a", request());
    expect(result.status).toBe(200);
    expect(judgeSubmissionResponseSchema.parse(result.body)).toMatchObject({ ok: true, submission: {
      verdict, testsPassed, testsTotal: 2,
      publicCases: [{ id: "sample:1", title: "Public example", input: "value = 7", expected: "42", output: actual, passed: actual === "42" }],
    } });
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("HIDDEN");
    expect(serialized).not.toContain("fixtureIndex");
    expect(serialized).not.toContain("__LEETCOLLAB");
  });

  it("refuses raw stdout on a framed fixture and retains the charge without fabricating a pass", async () => {
    const repository = new MemoryRepository(publicConfig());
    const provider = new OutputProvider("42\nHIDDEN_EXPECTED\n");
    const result = await new JudgeService(repository, provider, { now: () => now }).submit("user-a", request());
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ ok: false, error: { code: "JUDGE_UNAVAILABLE" }, quota: { used: 1 } });
    expect(JSON.stringify(result.body)).not.toContain("HIDDEN_EXPECTED");
    expect([...repository.submissions.values()][0]).toMatchObject({ judgeState: "failed", testsPassed: 0 });
  });

  it("replays a completed Submit when participant capture is unavailable", async () => {
    const repository = new MemoryRepository(publicConfig());
    const provider = new OutputProvider(framed(["42", "HIDDEN_EXPECTED"]));
    const captureParticipants = vi.fn(async () => ({ roomId: null, userIds: ["user-a"], capturedAt: now.toISOString() }));
    const service = new JudgeService(repository, provider, { now: () => now, captureParticipants });
    const submit = { ...request(), action: "submit" as const };
    const initial = await service.submit("user-a", submit);
    captureParticipants.mockRejectedValue(new Error("Snapshot unavailable"));
    const replay = await service.submit("user-a", submit);
    expect(replay.body).toMatchObject({ ok: true, quota: { used: 1 }, submission: { verdict: "accepted" } });
    if (initial.body.ok && replay.body.ok) expect(replay.body.submission.id).toBe(initial.body.submission.id);
    expect(captureParticipants).toHaveBeenCalledTimes(1);
    expect(provider.calls).toBe(1);
  });

  it("does not invent observed results for a replay without retained per-case evidence", async () => {
    const repository = new MemoryRepository(publicConfig());
    const provider = new OutputProvider(framed(["42", "HIDDEN_EXPECTED"]));
    const service = new JudgeService(repository, provider, { now: () => now });
    const key = randomUUID();
    await service.submit("user-a", request(key));
    const result = await service.submit("user-a", request(key));
    expect(result.body).toMatchObject({ ok: true, submission: { verdict: "accepted" } });
    expect(result.body.ok && result.body.submission.publicCases).toBeUndefined();
    expect(provider.calls).toBe(1);
  });

  it("returns source-mapped structured compiler errors and an authentic total without private echoes", async () => {
    const repository = new MemoryRepository(publicConfig());
    const provider = new OnlineCompilerProvider({ apiKey: "synthetic", executionApproved: true, policyAccepted: true,
      fetch: async () => new Response(JSON.stringify({ output: "", status: "error", exit_code: 1, signal: null, truncated: false,
        error: "Main.java:2: error: ';' expected\nPRIVATE_ECHO\nMain.java:2: error: ';' expected\nPRIVATE_ECHO\nMain.java:99: error: cannot find symbol\nHIDDEN_INPUT\n3 errors\n",
      })) });
    const result = await new JudgeService(repository, provider, { now: () => now }).submit("user-a", {
      ...request(), sourceCode: "\n\nclass Solution {\n  public static int answer() { return 42; }\n}",
    });
    expect(judgeSubmissionResponseSchema.parse(result.body)).toMatchObject({ ok: true, submission: {
      verdict: "compile_error", compilerErrorCount: 3, compilerDiagnosticsComplete: false,
      compilerDiagnostics: [{ line: 4, message: "Expected a semicolon (;)." }, { line: 4, message: "Expected a semicolon (;)." }],
      publicCases: [{ output: null, passed: null }],
    } });
    expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE|HIDDEN|Main\.java/);
  });
});

describe("JudgeService", () => {
  it.each(["run", "submit"] as const)("persists authenticated %s intent and captures room credit only for Submit", async action => {
    const repository = new MemoryRepository(config());
    const reserve = vi.spyOn(repository, "reserve");
    const captureParticipants = vi.fn(async () => ({ roomId: "abcdefgh", userIds: ["user-a", "user-b"], capturedAt: now.toISOString() }));
    const notifyCompletion = vi.fn(async () => { throw new Error("Hint lost after durable completion"); });
    const service = new JudgeService(repository, new OutputProvider(), { now: () => now, captureParticipants, notifyCompletion });
    const result = await service.submit("user-a", { ...request(), action });
    expect(result.status).toBe(200);
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", action,
      participants: { roomId: action === "submit" ? "abcdefgh" : null,
        userIds: action === "submit" ? ["user-a", "user-b"] : ["user-a"], capturedAt: now.toISOString() } }));
    expect(captureParticipants).toHaveBeenCalledTimes(action === "submit" ? 1 : 0);
    expect(notifyCompletion).toHaveBeenCalledTimes(action === "submit" ? 1 : 0);
  });

  it("refuses an unverified room snapshot before charging or executing", async () => {
    const repository = new MemoryRepository(config());
    const reserve = vi.spyOn(repository, "reserve");
    const provider = new OutputProvider();
    const service = new JudgeService(repository, provider, { captureParticipants: async () => { throw new Error("Snapshot unavailable"); } });
    await expect(service.submit("user-a", { ...request(), action: "submit" })).rejects.toThrow("Snapshot unavailable");
    expect(reserve).not.toHaveBeenCalled();
    expect(provider.calls).toBe(0);
  });

  it("retains prior local usage and refuses the 51st execution", async () => {
    const repository = new MemoryRepository(config());
    repository.limit = 50;
    repository.used = 49;
    const provider = Object.assign(new OutputProvider(), { id: "onlinecompiler" as const });
    const service = new JudgeService(repository, provider, { localTesting: true, quotaLimit: 100, now: () => now });
    expect((await service.status(problemId)).body).toMatchObject({ limit: 50, used: 49, remaining: 1 });
    const key = randomUUID();
    expect((await service.submit("user-a", request(key))).body).toMatchObject({ ok: true, quota: { used: 50, remaining: 0 } });
    await service.submit("user-a", request(key));
    expect((await service.submit("user-a", request())).body).toMatchObject({
      ok: false, error: { code: "QUOTA_EXHAUSTED" }, quota: { used: 50, remaining: 0 },
    });
    expect(provider.calls).toBe(1);
  });

  it.each([[undefined, true], ["jdoodle", true], ["onlinecompiler", false]] as const)("keeps the normal 25 ceiling for provider %s with localTesting=%s", async (id, localTesting) => {
    const repository = new MemoryRepository(config());
    repository.limit = 50;
    const provider = Object.assign(new OutputProvider(), { id });
    const service = new JudgeService(repository, provider, { localTesting, quotaLimit: 50, now: () => now });
    expect((await service.status(problemId)).body).toMatchObject({ limit: 25 });
  });

  it("retains the evaluation ceiling even with an injected local opt-in", async () => {
    const repository = new MemoryRepository(config());
    repository.limit = 50;
    const provider = Object.assign(new OutputProvider(), { id: "onlinecompiler" as const });
    const service = new JudgeService(repository, provider, {
      localTesting: true, quotaLimit: 50, now: () => now,
      evaluation: {
        userId: "user-a", problemId, baselineUsed: 0, quotaLimit: 20,
        startsAt: now.getTime() - 1, expiresAt: now.getTime() + 1000,
        period: { start: "2026-11-09T23:55:00.000Z", end: "2026-11-10T23:55:00.000Z" },
      },
    });
    expect((await service.status(problemId, "user-a")).body).toMatchObject({ limit: 20 });
  });

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

describe("Render policy admission stays inside the shared judge service", () => {
  const provenance = { provider: "render" as const, workspaceId: "synthetic workspace", groupId: "synthetic group", imageId: "synthetic image", toolchain: "synthetic JDK" };
  it("does not execute or reserve Render without an explicit policy", async () => {
    const repository = new MemoryRepository(config());
    const provider = Object.assign(new OutputProvider(), { provenance });
    const service = new JudgeService(repository, provider);
    expect((await service.status(problemId)).body).toMatchObject({ available: false });
    expect((await service.submit("user-a", request())).status).toBe(503);
    expect(repository.used).toBe(0);
    expect(provider.calls).toBe(0);
  });
  it("requires the durable attempt contract and never silently falls back to JDoodle admission", async () => {
    const repository = new MemoryRepository(config());
    const provider = Object.assign(new OutputProvider(), { provenance });
    const result = await new JudgeService(repository, provider, { renderPolicyId: "synthetic-policy" }).submit("user-a", request());
    expect(result.status).toBe(503);
    expect(provider.calls).toBe(0);
  });
  it("rejects attaching Render policy to a different provider", () => {
    expect(() => new JudgeService(new MemoryRepository(config()), new OutputProvider(), { renderPolicyId: "synthetic-policy" })).toThrow();
  });
});

it.each(["busy", "exhausted", "unconfigured"] as const)("keeps private Render admission %s out of public status", async (admission) => {
  const repository = new MemoryRepository(config());
  const getQuota = async () => ({ ...repository.quota(), admission });
  const bound = Object.assign(repository, { getQuota });
  const provider = Object.assign(new OutputProvider(), { provenance: {
    provider: "render" as const, workspaceId: "fixture", groupId: "fixture", imageId: "fixture", toolchain: "fixture",
  } });
  const result = await new JudgeService(bound, provider, { renderPolicyId: "synthetic" }).status(problemId);
  expect(result.body).toMatchObject({ available: false, used: 0 });
  expect(result.body).not.toHaveProperty("admission");
});

describe("OnlineCompiler uses the existing verified comparison and persistence path", () => {
  const success = { output: "42\n", error: "", status: "success", exit_code: 0, signal: null, truncated: false };
  const options = { apiKey: "synthetic-rest-key", policyAccepted: true, executionApproved: true };

  it.each([
    [success, "accepted", 1],
    [{ ...success, output: "41\n" }, "wrong_answer", 0],
    [{ ...success, output: "", error: "Main.java:2: error: cannot find symbol", status: "error", exit_code: 1 }, "compile_error", 0],
  ] as const)("persists only the verdict supported by provider evidence and fixtures: %s", async (payload, verdict, passed) => {
    const repository = new MemoryRepository(config());
    const reserve = vi.spyOn(repository, "reserve");
    const send = vi.fn(async () => new Response(JSON.stringify(payload)));
    const provider = new OnlineCompilerProvider({ ...options, fetch: send as typeof fetch });
    const service = new JudgeService(repository, provider, { now: () => now });
    const input = request();
    const first = await service.submit("user-a", input);
    expect(first.body).toMatchObject({ ok: true, submission: {
      judgeState: "completed", verdict, verification: "leetcollab", testsPassed: passed, testsTotal: 1,
    }, quota: { used: 1, active: 0 } });
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ runner: "onlinecompiler" }));
    expect(await service.submit("user-a", input)).toEqual(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await repository.getSubmission("user-b", [...repository.submissions.keys()][0])).toBeNull();
  });

  it("retains an ambiguous capacity refusal without declaring the entire account quota exhausted", async () => {
    const repository = new MemoryRepository(config());
    const exhaust = vi.spyOn(repository, "exhaust");
    const send = vi.fn(async () => new Response(JSON.stringify(success), { status: 429 }));
    const service = new JudgeService(repository,
      new OnlineCompilerProvider({ ...options, fetch: send as typeof fetch }), { now: () => now });
    const input = request();
    expect((await service.submit("user-a", input)).body).toMatchObject({
      ok: false, error: { code: "JUDGE_UNAVAILABLE" }, quota: { used: 1, remaining: 19 },
    });
    expect([...repository.submissions.values()][0]).toMatchObject({ judgeState: "failed", testsPassed: 0 });
    await service.submit("user-a", input);
    expect(send).toHaveBeenCalledTimes(1);
    expect(exhaust).not.toHaveBeenCalled();
  });
});

it.each(["compile_error", "runtime_error"] as const)("withholds legacy raw %s diagnostics on idempotent reads", async verdict => {
  const repository = new MemoryRepository(config());
  const provider = new OutputProvider();
  const service = new JudgeService(repository, provider, { now: () => now });
  const input = request();
  await service.submit("user-a", input);
  const saved = [...repository.submissions.values()][0];
  saved.verdict = verdict;
  saved.diagnostics = "Main.java:1: error: cannot find symbol\nPRIVATE_HARNESS_SOURCE PRIVATE_INPUT PRIVATE_EXPECTED";
  const replay = await service.submit("user-a", input);
  expect(JSON.stringify(replay.body)).not.toMatch(/PRIVATE|Main.java|cannot find symbol/);
  expect(replay.body).toMatchObject({ ok: true, submission: { verdict } });
  expect(provider.calls).toBe(1);
});
