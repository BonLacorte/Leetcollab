import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the HTTP routes, production composition, repository and real adapter.
// Only the external Supabase boundary and compiler transport are synthetic.
const db = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../lib/server/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ auth: { getUser: db.getUser }, from: db.from, rpc: db.rpc }),
}));
import { GET } from "./status/route";
import { POST } from "./submissions/route";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const problem = "11111111-1111-4111-8111-111111111111";
const otherProblem = "22222222-2222-4222-8222-222222222222";
const submission = "33333333-3333-4333-8333-333333333333";
const periodEnd = "2026-11-17T23:55:00.000Z";
const payload = { problemId: problem, language: "java", sourceCode: "class Solution { public static int answer() { return 42; } }", idempotencyKey: submission };
const settings = {
  JUDGE_ACCESS_MODE: "evaluation", JUDGE_PROVIDER: "onlinecompiler",
  JUDGE_EVALUATION_USER_ID: A, JUDGE_EVALUATION_PROBLEM_ID: problem,
  JUDGE_EVALUATION_PERIOD_START: "2026-11-16T23:55:00.000Z",
  JUDGE_EVALUATION_STARTS_AT: "2026-11-17T10:00:00.000Z",
  JUDGE_EVALUATION_EXPIRES_AT: "2026-11-17T10:10:00.000Z",
  JUDGE_EVALUATION_BASELINE_USED: "7", JUDGE_DAILY_LIMIT: "9",
  JUDGE_MAX_CONCURRENCY: "1", JUDGE_RESERVATION_SECONDS: "45", JUDGE_REQUEST_TIMEOUT_MS: "15000",
  ONLINECOMPILER_API_KEY: "synthetic-key", ONLINECOMPILER_POLICY_ACCEPTED: "true", ONLINECOMPILER_EXECUTION_APPROVED: "true",
};
let quotaRow: Record<string, unknown> | null;
let network: ReturnType<typeof vi.fn>;
function status(user = A, id = problem) {
  return GET(new Request(`https://app.test/api/judge/status?problemId=${id}`, { headers: { authorization: `Bearer ${user}` } }));
}
function submit(user = A, id = problem) {
  return POST(new Request("https://app.test/api/judge/submissions", { method: "POST",
    headers: { authorization: `Bearer ${user}` }, body: JSON.stringify({ ...payload, problemId: id }) }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T10:01:00Z"));
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
  vi.resetAllMocks();
  quotaRow = { used: 7, quota_limit: 20, active: 0, period_end: periodEnd };
  db.getUser.mockImplementation(async token => ({ data: { user: { id: token } }, error: null }));
  db.from.mockImplementation(table => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ error: null, data:
      table === "judge_quota_periods" ? quotaRow : table === "problem_judge_configs" ? {
        problem_id: problem, fixture_version: 1, harness_source: "class Main { public static void main(String[] args) { System.out.println(Solution.answer()); } }", expected_output: ["42"],
      } : { id: submission, problem_id: problem, verdict: "accepted", judge_state: "completed", tests_passed: 1, tests_total: 1, duration_ms: 1, created_at: "2026-11-17T10:01:00Z" },
    })) };
    return query;
  });
  db.rpc.mockImplementation(async name => ({ error: null, data: {
    result: name === "complete_judge_submission" ? "completed" : "reserved", submissionId: submission,
    used: 8, limit: 9, active: name === "complete_judge_submission" ? 0 : 1, resetAt: periodEnd,
  } }));
  network = vi.fn(async () => new Response(JSON.stringify({ status: "success", output: "42\n", error: "", exit_code: 0, signal: null, truncated: false })));
  vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([B, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"])("denies authenticated non-tester %s before composition or quota mutation", async user => {
  expect((await status(user)).status).toBe(503);
  expect((await submit(user)).status).toBe(503);
  expect(db.from).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("denies the tester's wrong problem on both endpoints", async () => {
  expect((await status(A, otherProblem)).status).toBe(503);
  expect((await submit(A, otherProblem)).status).toBe(503);
  expect(db.from).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("records only the evaluation actor even when realtime confirms a peer in the room", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "http://127.0.0.1:3001");
  const fetched = network.getMockImplementation()!;
  const roomId = "abcdefgh";
  network.mockImplementation(async (url, options) => new URL(String(url)).pathname === "/judge/participants"
    ? new Response(JSON.stringify({ problemId: problem, roomId, userIds: [A, B], capturedAt: "2026-11-17T10:01:00Z" }))
    : fetched(url, options));
  const from = db.from.getMockImplementation()!;
  db.from.mockImplementation(table => {
    const query = from(table);
    if (table === "submissions") {
      const maybeSingle = query.maybeSingle;
      query.maybeSingle = vi.fn(async () => query.select.mock.calls.some(([fields]: [string]) => fields === "id")
        ? { data: null, error: null } : maybeSingle());
    }
    return query;
  });
  const response = await POST(new Request("https://app.test/api/judge/submissions", {
    method: "POST", headers: { authorization: `Bearer ${A}` },
    body: JSON.stringify({ ...payload, action: "submit", roomId }),
  }));
  expect(response.status).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith("reserve_judge_execution", expect.objectContaining({
    p_action: "submit", p_scope: "shared", p_room_id: null, p_participant_ids: [A],
  }));
  expect(network).toHaveBeenCalledTimes(2);
  expect(network.mock.calls.some(([url]) => new URL(String(url)).pathname === "/judge/refresh")).toBe(false);
});

it("allows only A's pinned problem, using the exact shared cap and synthetic transport", async () => {
  const available = await status();
  expect(available.status).toBe(200);
  expect(await available.json()).toMatchObject({ available: true, provider: "onlinecompiler", quotaScope: "shared" });
  expect(network).not.toHaveBeenCalled();
  const response = await submit();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, submission: { verdict: "accepted", testsPassed: 1 } });
  expect(network).toHaveBeenCalledTimes(1);
  expect(db.rpc).toHaveBeenCalledWith("reserve_judge_execution", expect.objectContaining({
    p_scope: "shared", p_runner: "onlinecompiler", p_action: "run",
    p_user_id: A, p_problem_id: problem, p_quota_limit: 9, p_active_limit: 1, p_reservation_seconds: 45,
    p_period_start: settings.JUDGE_EVALUATION_PERIOD_START, p_period_end: periodEnd,
  }));
  for (const hidden of [A, settings.JUDGE_EVALUATION_STARTS_AT, "synthetic-key", "baseline"]) expect(JSON.stringify(body)).not.toContain(hidden);
});

// Oracle: the approved window is [10:00,10:10), in a single 23:55 UTC period.
it.each(["2026-11-17T09:59:59.999Z", "2026-11-17T10:10:00.000Z", "2026-11-17T23:55:00.000Z", "2026-11-18T10:01:00.000Z"])("closes both routes at %s without touching quota", async time => {
  vi.setSystemTime(new Date(time));
  expect((await status()).status).toBe(503);
  expect((await submit()).status).toBe(503);
  expect(db.from).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("admits at the inclusive start", async () => {
  vi.setSystemTime(new Date(settings.JUDGE_EVALUATION_STARTS_AT));
  expect((await submit()).status).toBe(200);
  expect(network).toHaveBeenCalledTimes(1);
});

it.each(Object.keys(settings).filter(name => name.startsWith("JUDGE_") && name !== "JUDGE_ACCESS_MODE"))("fails closed with missing %s", async name => {
  vi.stubEnv(name, undefined);
  expect((await status()).status).toBe(503);
  expect((await submit()).status).toBe(503);
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it.each([
  ["JUDGE_ACCESS_MODE", ""], ["JUDGE_ACCESS_MODE", "typo"],
  ["JUDGE_PROVIDER", "jdoodle"], ["JUDGE_EVALUATION_USER_ID", "not-a-uuid"],
  ["JUDGE_EVALUATION_PROBLEM_ID", "not-a-uuid"],
  ["JUDGE_EVALUATION_PERIOD_START", "2026-11-17T00:00:00Z"],
  ["JUDGE_EVALUATION_PERIOD_START", "2026-11-16T23:55:00.001Z"],
  ["JUDGE_EVALUATION_PERIOD_START", "2026-11-15T23:55:00Z"],
  ["JUDGE_EVALUATION_STARTS_AT", "2026-11-17T10:00:00+00:00"],
  ["JUDGE_EVALUATION_STARTS_AT", "2026-11-31T10:00:00Z"],
  ["JUDGE_EVALUATION_STARTS_AT", "2026-11-17T09:59:59Z"],
  ["JUDGE_EVALUATION_STARTS_AT", "2026-11-17T10:10:00Z"],
  ["JUDGE_EVALUATION_EXPIRES_AT", "2026-11-17T23:54:00Z"],
  ["JUDGE_EVALUATION_BASELINE_USED", "19"], ["JUDGE_EVALUATION_BASELINE_USED", "-1"],
  ["JUDGE_EVALUATION_BASELINE_USED", "6.5"], ["JUDGE_DAILY_LIMIT", "20"],
  ["JUDGE_DAILY_LIMIT", "8"], ["JUDGE_DAILY_LIMIT", "bad"],
  ["JUDGE_MAX_CONCURRENCY", "4"], ["JUDGE_RESERVATION_SECONDS", "35"],
  ["JUDGE_REQUEST_TIMEOUT_MS", "30000"],
])("rejects inconsistent configuration %s=%s on both routes", async (name, value) => {
  vi.stubEnv(name, value);
  expect((await status()).status).toBe(503);
  expect((await submit()).status).toBe(503);
  expect(db.from).not.toHaveBeenCalled();
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("requires expiry at least two minutes before reset even for a short window", async () => {
  vi.stubEnv("JUDGE_EVALUATION_STARTS_AT", "2026-11-17T23:50:00Z");
  vi.stubEnv("JUDGE_EVALUATION_EXPIRES_AT", "2026-11-17T23:53:00.001Z");
  vi.setSystemTime(new Date("2026-11-17T23:51:00Z"));
  expect((await status()).status).toBe(503);
  expect((await submit()).status).toBe(503);
  expect(db.rpc).not.toHaveBeenCalled();
  vi.stubEnv("JUDGE_EVALUATION_EXPIRES_AT", "2026-11-17T23:53:00Z");
  expect((await status()).status).toBe(200);
});
it.each([
  null,
  { used: 7, quota_limit: 20, active: 1, period_end: periodEnd },
  { used: 6, quota_limit: 20, active: 0, period_end: periodEnd },
  { used: 7, quota_limit: 8, active: 0, period_end: periodEnd },
  { used: 7, quota_limit: 20, active: 0, period_end: "2026-11-18T23:55:00Z" },
])("denies a missing/stale/incompatible shared baseline before mutation: %j", async row => {
  quotaRow = row;
  expect((await status()).status).toBe(503);
  expect((await submit()).status).toBe(503);
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("permits a new period row only with an explicit zero baseline and limit two", async () => {
  quotaRow = null;
  vi.stubEnv("JUDGE_EVALUATION_BASELINE_USED", "0");
  vi.stubEnv("JUDGE_DAILY_LIMIT", "2");
  db.rpc.mockImplementation(async name => ({ error: null, data: {
    result: name === "complete_judge_submission" ? "completed" : "reserved", submissionId: submission,
    used: 1, limit: 2, active: 1, resetAt: periodEnd,
  } }));
  expect((await submit()).status).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith("reserve_judge_execution", expect.objectContaining({ p_quota_limit: 2 }));
});
it("rechecks after a delayed quota read before any quota mutation", async () => {
  db.from.mockImplementation(() => ({ select() { return this; }, eq() { return this; },
    async maybeSingle() {
      vi.setSystemTime(new Date(settings.JUDGE_EVALUATION_EXPIRES_AT));
      return { data: quotaRow, error: null };
    },
  }));
  expect((await submit()).status).toBe(503);
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it.each([settings.JUDGE_EVALUATION_EXPIRES_AT, periodEnd])("retains a queued reservation but sends nothing when admission ends at %s", async time => {
  db.rpc.mockImplementation(async name => {
    if (name === "reserve_judge_execution") vi.setSystemTime(new Date(time));
    return { data: { result: name === "complete_judge_submission" ? "completed" : "reserved",
      submissionId: submission, used: 8, active: name === "complete_judge_submission" ? 0 : 1, limit: 9, resetAt: periodEnd }, error: null };
  });
  expect((await submit()).status).toBe(503);
  expect(network).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenCalledWith("complete_judge_submission", expect.objectContaining({ p_judge_state: "failed" }));
  expect(db.rpc).not.toHaveBeenCalledWith("exhaust_judge_quota", expect.anything());
});
it("checks the window inside the real adapter immediately before outbound fetch", async () => {
  // Advance time during local program preparation, after the service's final check.
  const { OnlineCompilerProvider } = await import("../../../lib/server/judge/onlinecompiler");
  const original = OnlineCompilerProvider.prototype.execute;
  const spy = vi.spyOn(OnlineCompilerProvider.prototype, "execute").mockImplementation(function(this: InstanceType<typeof OnlineCompilerProvider>, source) {
    vi.setSystemTime(new Date(settings.JUDGE_EVALUATION_EXPIRES_AT));
    return original.call(this, source);
  });
  try {
    expect((await submit()).status).toBe(503);
    expect(network).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("complete_judge_submission", expect.objectContaining({ p_judge_state: "failed" }));
  } finally { spy.mockRestore(); }
});
it("keeps provider approval mandatory in evaluation mode", async () => {
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "false");
  expect((await status()).status).toBe(200);
  expect(await (await status()).json()).toMatchObject({ available: false });
  expect((await submit()).status).toBe(503);
  expect(db.rpc).not.toHaveBeenCalledWith("reserve_judge_execution", expect.anything());
  expect(network).not.toHaveBeenCalled();
});

it.each(["in_progress", "busy", "exhausted", "existing"])("does not transmit for a %s reservation result", async result => {
  db.rpc.mockResolvedValue({ error: null, data: { result, submissionId: submission,
    used: 9, limit: 9, active: 0, resetAt: periodEnd } });
  const response = await submit();
  expect(response.status).toBe(result === "existing" ? 200 : 429);
  expect(network).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenCalledTimes(1);
});

it("does not compose a provider for denied identities", async () => {
  const { OnlineCompilerProvider } = await import("../../../lib/server/judge/onlinecompiler");
  const compose = vi.spyOn(OnlineCompilerProvider, "fromEnvironment");
  try {
    expect((await status(B)).status).toBe(503);
    expect((await submit(B)).status).toBe(503);
    expect(compose).not.toHaveBeenCalled();
  } finally { compose.mockRestore(); }
});
it("denies unavailable read-only quota inspection without falling back to mutating status", async () => {
  db.from.mockImplementation(() => ({ select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: null, error: new Error("synthetic unavailable database") }; },
  }));
  expect((await status()).status).toBe(503);
  expect((await submit()).status).toBe(503);
  expect(db.rpc).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("does not advertise availability if status work finishes after expiry", async () => {
  db.rpc.mockImplementation(async () => {
    vi.setSystemTime(new Date(settings.JUDGE_EVALUATION_EXPIRES_AT));
    return { data: { used: 7, limit: 9, active: 0, resetAt: periodEnd }, error: null };
  });
  expect((await status()).status).toBe(503);
  expect(network).not.toHaveBeenCalled();
});

it("allows the maximum valid baseline 18 with the hard ceiling 20", async () => {
  vi.stubEnv("JUDGE_EVALUATION_BASELINE_USED", "18");
  vi.stubEnv("JUDGE_DAILY_LIMIT", "20");
  quotaRow = { used: 18, quota_limit: 20, active: 0, period_end: periodEnd };
  db.rpc.mockImplementation(async name => ({ error: null, data: {
    result: name === "complete_judge_submission" ? "completed" : "reserved", submissionId: submission,
    used: 19, limit: 20, active: 1, resetAt: periodEnd,
  } }));
  expect((await submit()).status).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith("reserve_judge_execution", expect.objectContaining({ p_quota_limit: 20 }));
  expect(network).toHaveBeenCalledTimes(1);
});
