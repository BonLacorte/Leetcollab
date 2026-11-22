import { afterEach, beforeEach, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({ reserve: vi.fn(), complete: vi.fn(), getQuota: vi.fn() }));

vi.mock("../supabase-admin", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("./supabase-repository", () => ({
  SupabaseJudgeRepository: class {
    async getConfig() { return {
      problemId: "11111111-1111-4111-8111-111111111111", fixtureVersion: 1, fallback: null,
      harnessSource: "class Main { public static void main(String[] args) { System.out.println(Solution.answer()); } }",
      expectedOutput: ["42"],
    }; }
    getQuota = repository.getQuota;
    reserve = repository.reserve;
    complete = repository.complete;
  },
}));

beforeEach(() => {
  repository.getQuota.mockReset().mockResolvedValue({
    used: 0, remaining: 20, active: 0, limit: 20, resetAt: "2026-11-15T23:55:00Z",
  });
  repository.reserve.mockReset().mockResolvedValue({
    result: "reserved", submissionId: "22222222-2222-4222-8222-222222222222",
    quota: { used: 1, remaining: 19, active: 1, limit: 20, resetAt: "2026-11-15T23:55:00Z" },
  });
  repository.complete.mockReset().mockImplementation(async completion => ({
    submission: { ...completion, id: completion.submissionId, verification: "leetcollab" },
    quota: { used: 1, remaining: 19, active: 0, limit: 20, resetAt: "2026-11-15T23:55:00Z" },
  }));
});

it.each([
  ["local development", "development", "true", "http://127.0.0.1:55421", undefined, 50],
  ["localhost", "development", "true", "http://localhost:55421", undefined, 50],
  ["IPv6 loopback", "development", "true", "http://[::1]:55421", undefined, 50],
  ["production", "production", "true", "http://127.0.0.1:55421", undefined, 25],
  ["no opt in", "development", undefined, "http://127.0.0.1:55421", undefined, 25],
  ["remote database", "development", "true", "https://project.supabase.co", undefined, 25],
  ["lookalike hostname", "development", "true", "http://localhost.example.com", undefined, 25],
  ["invalid database URL", "development", "true", "invalid", undefined, 25],
  ["remote server URL overrides public loopback", "development", "true", "http://localhost:55421", "https://project.supabase.co", 25],
] as const)("uses the 50 ceiling only for opted-in %s", async (_label, nodeEnv, flag, publicUrl, serverUrl, limit) => {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("JUDGE_LOCAL_TESTING", flag);
  vi.stubEnv("JUDGE_DAILY_LIMIT", "100");
  vi.stubEnv("JUDGE_ACCESS_MODE", "normal");
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", publicUrl);
  vi.stubEnv("SUPABASE_URL", serverUrl);
  vi.stubEnv("ONLINECOMPILER_API_KEY", "synthetic-rest-key");
  vi.stubEnv("ONLINECOMPILER_POLICY_ACCEPTED", "true");
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "true");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  await getJudgeService().status("problem");
  expect(repository.getQuota).toHaveBeenCalledWith(expect.anything(), limit, undefined);
  expect(network).not.toHaveBeenCalled();
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("keeps production status unconfigured when only Render flags and identities are present", async () => {
  // Oracle: offline preparation must not change the application's provider selection.
  for (const name of ["JDOODLE_CLIENT_ID", "JDOODLE_CLIENT_SECRET", "JDOODLE_JAVA_VERSION_INDEX", "JDOODLE_LIMITS_CONFIRMED"])
    vi.stubEnv(name, undefined);
  vi.stubEnv("RENDER_ENABLED", "true");
  vi.stubEnv("RENDER_ACTIVATED", "true");
  vi.stubEnv("RENDER_API_KEY", "mock-not-a-key");
  vi.stubEnv("RENDER_WORKSPACE_ID", "tea-csprhmi3esus73alsv70");
  vi.stubEnv("RENDER_SANDBOX_GROUP_ID", "sbg-cph1rs3idesc73a2b2mg");
  vi.stubEnv("RENDER_IMAGE_ID", "sbb-cph1rs3idesc73a2b2mg");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  await expect(getJudgeService().status("problem")).resolves.toMatchObject({
    body: { available: false, unavailableReason: "provider_unconfigured", used: 0 },
  });
  expect(network).not.toHaveBeenCalled();
});

function configuredLegacy() {
  vi.stubEnv("JDOODLE_CLIENT_ID", "synthetic-id");
  vi.stubEnv("JDOODLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("JDOODLE_JAVA_VERSION_INDEX", "5");
  vi.stubEnv("JDOODLE_LIMITS_CONFIRMED", "true");
}

it.each(["disabled", "render", "unknown-provider"])("refuses unsupported or disabled selection %s without fallback", async selected => {
  configuredLegacy();
  vi.stubEnv("JUDGE_PROVIDER", selected);
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  await expect(getJudgeService().status("problem")).resolves.toMatchObject({
    body: { available: false, unavailableReason: "provider_unconfigured" },
  });
  expect(network).not.toHaveBeenCalled();
});

it("does not fall back to configured JDoodle when selected OnlineCompiler lacks approval", async () => {
  configuredLegacy();
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("ONLINECOMPILER_API_KEY", "synthetic-rest-key");
  vi.stubEnv("ONLINECOMPILER_POLICY_ACCEPTED", "false");
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "true");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService, getExecutionProvider } = await import("./context");
  expect(getExecutionProvider().id).toBe("onlinecompiler");
  await expect(getJudgeService().status("problem")).resolves.toMatchObject({
    body: { available: false, unavailableReason: "provider_unconfigured" },
  });
  expect(network).not.toHaveBeenCalled();
});

it("selects approved OnlineCompiler on the server without exposing its key or making a status execution", async () => {
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("ONLINECOMPILER_API_KEY", "synthetic-rest-key");
  vi.stubEnv("ONLINECOMPILER_POLICY_ACCEPTED", "true");
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "true");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  const result = await getJudgeService().status("problem");
  expect(result.body).toMatchObject({ available: true, unavailableReason: null });
  expect(JSON.stringify(result.body)).not.toContain("synthetic-rest-key");
  expect(network).not.toHaveBeenCalled();
});

it("preserves explicit JDoodle rollback and legacy deployments without a selector", async () => {
  configuredLegacy();
  const { getJudgeService } = await import("./context");
  for (const selected of [undefined, "jdoodle"]) {
    vi.stubEnv("JUDGE_PROVIDER", selected);
    await expect(getJudgeService().status("problem")).resolves.toMatchObject({ body: { available: true } });
  }
});

const editedRequest = {
  action: "run" as const,
  problemId: "11111111-1111-4111-8111-111111111111", language: "java" as const,
  sourceCode: "class Solution { public static int answer() { int edited = 6 * 7; return edited; } }",
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
};

it.each([
  ["absent policy", undefined, "true", "synthetic-rest-key"],
  ["false policy", "false", "true", "synthetic-rest-key"],
  ["absent execution authorization", "true", undefined, "synthetic-rest-key"],
  ["false execution authorization", "true", "false", "synthetic-rest-key"],
  ["missing key", "true", "true", undefined],
] as const)("normal composition rejects %s despite the legacy limits flag", async (_label, policy, approval, key) => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:55421");
  vi.stubEnv("JUDGE_LOCAL_TESTING", "true");
  vi.stubEnv("JUDGE_DAILY_LIMIT", "50");
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("ONLINECOMPILER_API_KEY", key);
  vi.stubEnv("ONLINECOMPILER_POLICY_ACCEPTED", policy);
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", approval);
  vi.stubEnv("ONLINECOMPILER_LIMITS_CONFIRMED", "true");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  const service = getJudgeService();
  expect((await service.status(editedRequest.problemId)).body).toMatchObject({
    available: false, provider: "onlinecompiler", remaining: 20, unavailableReason: "provider_unconfigured",
  });
  expect((await service.submit("synthetic-user", editedRequest)).body).toMatchObject({
    ok: false, error: { code: "JUDGE_UNAVAILABLE" }, quota: { used: 0 },
  });
  expect(network).not.toHaveBeenCalled();
  expect(repository.reserve).not.toHaveBeenCalled();
});

it.each([
  ["42\n", "", "success", 0, "accepted", 1],
  ["41\n", "", "success", 0, "wrong_answer", 0],
  ["", "Main.java:1: error: cannot find symbol", "error", 1, "compile_error", 0],
] as const)("normal composition judges edited source from deterministic provider output: %s", async (output, error, status, exit, verdict, passed) => {
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("ONLINECOMPILER_API_KEY", "synthetic-rest-key");
  vi.stubEnv("ONLINECOMPILER_POLICY_ACCEPTED", "true");
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "true");
  vi.stubEnv("ONLINECOMPILER_LIMITS_CONFIRMED", "false");
  const network = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
    output, error, status, exit_code: exit, signal: null, truncated: false,
  })));
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  const service = getJudgeService();
  expect((await service.status(editedRequest.problemId)).body).toMatchObject({ available: true, provider: "onlinecompiler" });
  expect(network).not.toHaveBeenCalled();
  expect((await service.submit("synthetic-user", editedRequest)).body).toMatchObject({
    ok: true, submission: { verdict, testsPassed: passed, testsTotal: 1, judgeState: "completed", verification: "leetcollab" },
  });
  expect(network).toHaveBeenCalledTimes(1);
  const [url, init] = network.mock.calls[0];
  expect(url).toBe("https://api.onlinecompiler.io/api/run-code-sync/");
  expect(JSON.parse(String(init?.body))).toEqual({
    compiler: "openjdk-25",
    code: `${editedRequest.sourceCode}\n\npublic class Main { public static void main(String[] args) { System.out.println(Solution.answer()); } }\n`,
  });
  expect(repository.reserve).toHaveBeenCalledWith(expect.objectContaining({ runner: "onlinecompiler", sourceCode: editedRequest.sourceCode }));
  expect(repository.complete).toHaveBeenCalledWith(expect.objectContaining({ verdict, testsPassed: passed, testsTotal: 1 }));
});

// Oracle: an ambiguous attempt stays charged and never becomes a verified pass.
it.each(["incomplete", "truncated", "stalled"])("normal composition retains quota and does not retry a %s result", async mode => {
  vi.useFakeTimers();
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("ONLINECOMPILER_API_KEY", "synthetic-rest-key");
  vi.stubEnv("ONLINECOMPILER_POLICY_ACCEPTED", "true");
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "true");
  vi.stubEnv("JUDGE_REQUEST_TIMEOUT_MS", "1000");
  const network = vi.fn(async () => mode === "stalled"
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"output":'));
    } }))
    : new Response(JSON.stringify(mode === "incomplete" ? { output: "42\n" } : {
      output: "42\n", error: "", status: "success", exit_code: 0, signal: null, truncated: true,
    })));
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  const attempt = getJudgeService().submit("synthetic-user", editedRequest);
  await vi.advanceTimersByTimeAsync(1001);
  const result = await attempt;
  expect(result.body).toMatchObject({ quota: { used: 1, remaining: 19 } });
  expect(repository.reserve).toHaveBeenCalledTimes(1);
  expect(network).toHaveBeenCalledTimes(1);
  expect(repository.complete).toHaveBeenCalledWith(expect.objectContaining({
    testsPassed: 0, verdict: mode === "truncated" ? "output_limit" : "runtime_error",
    judgeState: mode === "truncated" ? "completed" : "failed",
  }));
  if (mode !== "truncated") expect(result.body).toMatchObject({ ok: false, error: { code: "JUDGE_UNAVAILABLE" } });
});
