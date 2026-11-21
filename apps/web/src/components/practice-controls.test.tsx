import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PracticeControls } from "./practice-controls";
import { PracticeResult, type PracticeExecution } from "./room/practice-result";

vi.mock("./auth-provider", () => ({ useAuth: () => ({ session: { access_token: "token", user: { id: "user" } } }) }));
const mocks = vi.hoisted(() => ({ solved: vi.fn(), rpc: vi.fn(), socket: { on: vi.fn(), off: vi.fn() } }));
vi.mock("./socket-provider", () => ({ useSocket: () => mocks.socket }));
vi.mock("../lib/supabase", () => ({ supabase: {
  from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }) };
    return query;
  },
  rpc: (name: string, args: unknown) => name === "has_verified_problem_solve" ? mocks.solved(args) : mocks.rpc(name, args),
} }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
beforeEach(() => {
  mocks.solved.mockReset().mockResolvedValue({ data: false, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ suggested_review_at: "2026-11-20T12:00:00.000Z" }], error: null });
  mocks.socket.on.mockClear();
  mocks.socket.off.mockClear();
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
  await act(async () => { renderer = create(<PracticeControls problemId="problem" code="class Solution {}" onExecutionChange={() => {}} />); });
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
  await act(async () => { renderer = create(<PracticeControls problemId="problem" code="class Solution {}" onExecutionChange={() => {}} />); });
  expect(JSON.stringify(renderer.toJSON())).toContain("Judge status unavailable.");
  const refresh = renderer.root.findAllByType("button").find(node => node.children.includes("Refresh status"))!;
  await act(async () => refresh.props.onClick());
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Judge status unavailable.");
  expect(JSON.stringify(renderer.toJSON())).toContain("This original exercise must wait for quota reset.");
});


const quota = { available: true, used: 0, limit: 20, remaining: 20, active: 0, resetAt: "2026-11-13T23:55:00.000Z", fallback: null, unavailableReason: null };
const button = (label: string) => renderer.root.findAllByType("button").find(node => node.children.includes(label))!;
const output = () => JSON.stringify(renderer.toJSON());
const response = (body: unknown) => new Response(JSON.stringify(body));
async function renderControls() {
  function Harness() {
    const [execution, setExecution] = useState<PracticeExecution | null>(null);
    return <><PracticeControls problemId="11111111-1111-4111-8111-111111111111" code="class Solution {}" onExecutionChange={setExecution} /><PracticeResult execution={execution} /></>;
  }
  await act(async () => { renderer = create(<Harness />); });
}

it.each(["Run", "Submit"])("discloses OnlineCompiler retention before %s transmits code", async label => {
  const fetch = vi.fn().mockResolvedValue(response({ ...quota, provider: "onlinecompiler" }));
  vi.stubGlobal("fetch", fetch);
  await renderControls();
  const notice = renderer.root.findByProps({ className: "execution-notice" });
  expect(output()).toContain("Execution code, input and output are retained for 365 days.");
  expect(output()).toContain("Do not include secrets or sensitive information.");
  expect(notice.findAllByType("a").map(link => link.props.href)).toEqual([
    "https://onlinecompiler.io/privacy", "https://onlinecompiler.io/terms",
  ]);
  const controls = renderer.root.findByProps({ className: "practice-controls" });
  expect(controls.children[0]).toBe(notice);
  expect(button(label).props.disabled).toBe(false);
  expect(fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  await act(async () => { await button(label).props.onClick(); });
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
});

it.each([undefined, "jdoodle", "render", null])("does not misattribute retention to provider %s", async provider => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...quota, provider })));
  await renderControls();
  expect(renderer.root.findAllByProps({ className: "execution-notice" })).toHaveLength(0);
});

it("keeps the OnlineCompiler disclosure visible while execution is disabled", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
    ...quota, provider: "onlinecompiler", available: false, unavailableReason: "provider_unconfigured",
  })));
  await renderControls();
  expect(renderer.root.findAllByProps({ className: "execution-notice" })).toHaveLength(1);
  expect(button("Run").props.disabled).toBe(true);
  expect(output()).toContain("External sandbox is not configured.");
});

it.each([true, false])("renders the protected solved state %s", async solved => {
  mocks.solved.mockResolvedValue({ data: solved, error: null });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(quota)));
  await renderControls();
  expect(output().includes("Solved - LeetCollab verified")).toBe(solved);
  expect(mocks.solved).toHaveBeenCalledWith({ p_problem_id: "11111111-1111-4111-8111-111111111111" });
});

it.each(["Run", "Submit"])("%s sends its action to the authenticated judge and renders the verdict", async label => {
  const fetch = vi.fn().mockResolvedValue(response(quota));
  vi.stubGlobal("fetch", fetch);
  await renderControls();
  fetch.mockImplementation(async (_url, options) => {
    if (!options?.method) return response(quota);
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
    problemId: "11111111-1111-4111-8111-111111111111", action: label.toLowerCase(), sourceCode: "class Solution {}", language: "java", idempotencyKey: expect.any(String),
  });
  expect(renderer.root.findByType("h2").children).toEqual(["Accepted"]);
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

it("reloads only protected completion on a room-credit hint without spending or refreshing personal quota", async () => {
  const fetch = vi.fn().mockResolvedValue(response(quota));
  vi.stubGlobal("fetch", fetch);
  await renderControls();
  const notify = mocks.socket.on.mock.calls.find(([event]) => event === "practice:refresh")![1] as (value: { problemId: string }) => void;
  await act(async () => notify({ problemId: "11111111-1111-4111-8111-111111111111" }));
  expect(output()).not.toContain("Solved - LeetCollab verified");
  mocks.solved.mockResolvedValue({ data: true, error: null });
  await act(async () => notify({ problemId: "11111111-1111-4111-8111-111111111111" }));
  expect(output()).toContain("Solved - LeetCollab verified");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
});

it("an accepted Run preserves historical Submit credit", async () => {
  mocks.solved.mockResolvedValue({ data: true, error: null });
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => response(options?.method ? {
    ok: true, quota, submission: { id: "22222222-2222-4222-8222-222222222222", problemId: "11111111-1111-4111-8111-111111111111",
      language: "java", verification: "leetcollab", verdict: "accepted", action: "run",
      testsPassed: 4, testsTotal: 4, durationMs: 1, diagnostics: "", createdAt: "2026-11-13T12:00:00.000Z" },
  } : quota)));
  await renderControls();
  await act(async () => { await button("Run").props.onClick(); });
  expect(output()).toContain("Solved - LeetCollab verified");
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
  mocks.solved.mockResolvedValue({ data: null, error: new Error("offline") });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(quota)));
  await renderControls();
  expect(output()).toContain("Completion status unavailable.");
  expect(output()).not.toContain("Solved - LeetCollab verified");
  mocks.solved.mockResolvedValue({ data: true, error: null });
  await act(async () => { button("Refresh status").props.onClick(); });
  expect(output()).toContain("Solved - LeetCollab verified");
});


it("keeps retention visible and all actions disabled during a pending execution", async () => {
  const fetch = vi.fn().mockResolvedValue(response({ ...quota, provider: "onlinecompiler" }));
  vi.stubGlobal("fetch", fetch);
  await renderControls();
  fetch.mockImplementation(() => new Promise(() => {}));
  await act(async () => { void button("Run").props.onClick(); });
  expect(button("Working…").props.disabled).toBe(true);
  expect(button("Submit").props.disabled).toBe(true);
  expect(button("Refresh status").props.disabled).toBe(true);
  for (const grade of ["again", "hard", "good", "easy"]) expect(button(grade).props.disabled).toBe(true);
  expect(output()).toContain("Execution code, input and output are retained for 365 days.");
  expect(output()).toContain("Do not include secrets or sensitive information.");
});

it("labels reset time with a timezone and exposes grade intervals accessibly", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(quota)));
  await renderControls();
  const time = renderer.root.findByType("time");
  expect(time.props.dateTime).toBe(quota.resetAt);
  const parts = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).formatToParts(new Date(quota.resetAt));
  expect(time.children.join("")).toContain(parts.find(part => part.type === "timeZoneName")!.value);
  expect(button("again").props["aria-label"]).toBe("again, review in 1 day");
  expect(button("easy").props["aria-label"]).toBe("easy, review in 14 days");
});

it("keeps the exact request source and editor revision when code changes during execution", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn(async (_url, options) => options?.method
    ? new Promise<Response>(resolve => { finish = resolve; }) : response(quota));
  vi.stubGlobal("fetch", fetch);
  const changed = vi.fn<(execution: PracticeExecution) => void>();
  const sourceCode = "\r\nclass Solution {\r\n  // exact submitted bytes\r\n}";
  const problemId = "11111111-1111-4111-8111-111111111111";
  await act(async () => { renderer = create(<PracticeControls problemId={problemId} code={sourceCode} codeVersion={5} onExecutionChange={changed} />); });
  await act(async () => { void button("Run").props.onClick(); });
  await act(async () => renderer.update(<PracticeControls problemId={problemId} code="newer code" codeVersion={6} onExecutionChange={changed} />));
  await act(async () => finish(response({ ok: true, quota, submission: {
    id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verification: "leetcollab", verdict: "compile_error",
    testsPassed: 0, testsTotal: 4, durationMs: 10, diagnostics: "Compile failure", createdAt: "2026-11-13T12:00:00.000Z",
  } })));
  expect(changed.mock.calls.map(([value]) => ({ state: value.state, sourceCode: value.sourceCode, codeVersion: value.codeVersion }))).toEqual([
    { state: "running", sourceCode, codeVersion: 5 }, { state: "finished", sourceCode, codeVersion: 5 },
  ]);
  const posted = fetch.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(JSON.parse(posted[1]!.body as string).sourceCode).toBe(sourceCode);
});
