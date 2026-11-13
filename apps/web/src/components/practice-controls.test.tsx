import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PracticeControls } from "./practice-controls";

vi.mock("./auth-provider", () => ({ useAuth: () => ({ session: { access_token: "token", user: { id: "user" } } }) }));
const mocks = vi.hoisted(() => ({ submissions: vi.fn(), rpc: vi.fn(), filters: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: {
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: (field: string, value: string) => { mocks.filters(table, field, value); return query; },
      maybeSingle: async () => ({ data: null }),
      then: (resolve: (value: unknown) => unknown) => mocks.submissions().then(resolve),
    };
    return query;
  },
  rpc: mocks.rpc,
} }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
beforeEach(() => {
  mocks.submissions.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ suggested_review_at: "2026-11-20T12:00:00.000Z" }], error: null });
  mocks.filters.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([false, true])("ignores an older status success or failure after exhaustion (failure=%s)", async failure => {
  const pending: { resolve: (value: Response) => void; reject: (reason: Error) => void }[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }))));
  const status = (remaining: number) => new Response(JSON.stringify({ available: remaining > 0, used: 20 - remaining, limit: 20, remaining, active: 0, resetAt: "2026-11-13T23:55:00.000Z", fallback: null, unavailableReason: remaining ? null : "quota_exhausted" }));
  await act(async () => { renderer = create(<PracticeControls problemId="problem" code="class Solution {}" />); });
  await act(async () => pending[0].resolve(status(1)));
  const button = (label: string) => renderer.root.findAllByType("button").find(node => node.children.includes(label))!;
  await act(async () => button("Refresh status").props.onClick());
  await act(async () => { void button("Run").props.onClick(); });
  await act(async () => pending[2].resolve(new Response(JSON.stringify({ ok: false, error: { code: "QUOTA_EXHAUSTED", message: "Exhausted" } }))));
  await act(async () => pending[3].resolve(status(0)));
  await act(async () => { if (failure) pending[1].reject(new Error("offline")); else pending[1].resolve(status(1)); });
  expect(button("Run").props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("This original exercise must wait for quota reset.");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Judge status unavailable.");
});

it("clears a status failure after a successful refresh", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response(JSON.stringify({ available: false, used: 20, limit: 20, remaining: 0, active: 0, resetAt: "2026-11-13T23:55:00.000Z", fallback: null, unavailableReason: "quota_exhausted" }))));
  await act(async () => { renderer = create(<PracticeControls problemId="problem" code="class Solution {}" />); });
  expect(JSON.stringify(renderer.toJSON())).toContain("Judge status unavailable.");
  const refresh = renderer.root.findAllByType("button").find(node => node.children.includes("Refresh status"))!;
  await act(async () => refresh.props.onClick());
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Judge status unavailable.");
  expect(JSON.stringify(renderer.toJSON())).toContain("This original exercise must wait for quota reset.");
});


const quota = { available: true, used: 0, limit: 20, remaining: 20, active: 0, resetAt: "2026-11-13T23:55:00.000Z", fallback: null, unavailableReason: null };
const passing = { verification: "leetcollab", judge_state: "completed", verdict: "accepted", tests_passed: 4, tests_total: 4 };
const button = (label: string) => renderer.root.findAllByType("button").find(node => node.children.includes(label))!;
const output = () => JSON.stringify(renderer.toJSON());
const response = (body: unknown) => new Response(JSON.stringify(body));
async function renderControls() {
  await act(async () => { renderer = create(<PracticeControls problemId="11111111-1111-4111-8111-111111111111" code="class Solution {}" />); });
}

// Oracle: completion requires a persisted, completed LeetCollab verdict with all nonzero tests passing.
it.each([
  ["verified pass", passing, true],
  ["legacy history", { ...passing, verification: "legacy_unverified" }, false],
  ["external self report", { ...passing, verification: "external_self_reported" }, false],
  ["pending", { ...passing, judge_state: "reserved" }, false],
  ["provider failure", { ...passing, judge_state: "failed" }, false],
  ["wrong answer", { ...passing, verdict: "wrong_answer" }, false],
  ["compile error", { ...passing, verdict: "compile_error" }, false],
  ["runtime error", { ...passing, verdict: "runtime_error" }, false],
  ["time limit", { ...passing, verdict: "time_limit" }, false],
  ["memory limit", { ...passing, verdict: "memory_limit" }, false],
  ["output limit", { ...passing, verdict: "output_limit" }, false],
  ["no tests", { ...passing, tests_passed: 0, tests_total: 0 }, false],
  ["partial pass", { ...passing, tests_passed: 3 }, false],
] as const)("completion from persisted %s", async (_name, row, solved) => {
  mocks.submissions.mockResolvedValue({ data: [row], error: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(quota)));
  await renderControls();
  expect(output().includes("Solved - LeetCollab verified")).toBe(solved);
  expect(mocks.filters).toHaveBeenCalledWith("submissions", "user_id", "user");
  expect(mocks.filters).toHaveBeenCalledWith("submissions", "problem_id", "11111111-1111-4111-8111-111111111111");
});

it.each(["Run", "Submit"])("%s calls the existing authenticated judge and reloads persisted completion", async label => {
  const fetch = vi.fn().mockResolvedValue(response(quota));
  vi.stubGlobal("fetch", fetch);
  await renderControls();
  expect(output()).toContain("Not solved");
  fetch.mockImplementation(async (_url, options) => {
    if (!options?.method) return response(quota);
    mocks.submissions.mockResolvedValue({ data: [passing], error: null });
    return response({ ok: true, quota, submission: {
      id: "22222222-2222-4222-8222-222222222222", problemId: "11111111-1111-4111-8111-111111111111", language: "java",
      verdict: "accepted", verification: "leetcollab", testsPassed: 4, testsTotal: 4,
      durationMs: 10, diagnostics: null, createdAt: "2026-11-13T12:00:00.000Z",
    } });
  });
  await act(async () => { await button(label).props.onClick(); });
  const [url, options] = fetch.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(url).toBe("/api/judge/submissions");
  expect(options.headers.Authorization).toBe("Bearer token");
  expect(JSON.parse(options.body)).toEqual({
    problemId: "11111111-1111-4111-8111-111111111111", sourceCode: "class Solution {}", language: "java", idempotencyKey: expect.any(String),
  });
  expect(output()).toContain("Solved - LeetCollab verified");
  expect(output()).toContain("LeetCollab verdict: accepted");
});

it("does not infer completion from an accepted response without trusted persisted evidence", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, options) => response(options?.method ? {
    ok: true, quota, submission: {
      id: "22222222-2222-4222-8222-222222222222", problemId: "11111111-1111-4111-8111-111111111111", language: "java",
      verdict: "accepted", verification: "leetcollab", testsPassed: 4, testsTotal: 4,
      durationMs: 10, diagnostics: null, createdAt: "2026-11-13T12:00:00.000Z",
    },
  } : quota)));
  await renderControls();
  await act(async () => { await button("Submit").props.onClick(); });
  expect(output()).toContain("Not solved");
  expect(output()).not.toContain("Solved - LeetCollab verified");
});

it.each(["again", "hard", "good", "easy"])("personal grade %s schedules review without completion or execution", async grade => {
  const fetch = vi.fn().mockResolvedValue(response(quota));
  vi.stubGlobal("fetch", fetch);
  await renderControls();
  await act(async () => { await button(grade).props.onClick(); });
  expect(mocks.rpc).toHaveBeenCalledWith("record_problem_grade", { p_problem_id: "11111111-1111-4111-8111-111111111111", p_grade: grade });
  expect(output()).toContain(`Personal grade saved: ${grade}`);
  expect(output()).toContain("Suggested review:");
  expect(output()).toContain("Not solved");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["provider_unconfigured", "quota_exhausted"])("disables Run and Submit when %s", async unavailableReason => {
  const fetch = vi.fn().mockResolvedValue(response({ ...quota, available: false, unavailableReason }));
  vi.stubGlobal("fetch", fetch);
  await renderControls();
  expect(button("Run").props.disabled).toBe(true);
  expect(button("Submit").props.disabled).toBe(true);
  expect(output()).toContain("Not solved");
  await act(async () => { await button("Submit").props.onClick(); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("fails closed when stored completion cannot be read and recovers on refresh", async () => {
  mocks.submissions.mockResolvedValue({ data: null, error: new Error("offline") });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(quota)));
  await renderControls();
  expect(output()).toContain("Completion status unavailable.");
  expect(output()).not.toContain("Solved - LeetCollab verified");
  mocks.submissions.mockResolvedValue({ data: [passing], error: null });
  await act(async () => { button("Refresh status").props.onClick(); });
  expect(output()).toContain("Solved - LeetCollab verified");
});
