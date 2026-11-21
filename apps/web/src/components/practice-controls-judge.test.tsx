import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { JudgeService } from "../lib/server/judge/service";
import { OnlineCompilerProvider } from "../lib/server/judge/onlinecompiler";
import type { JudgeRepository, StoredSubmission } from "../lib/server/judge/types";
import { PracticeControls } from "./practice-controls";
import { POST } from "../app/api/judge/submissions/route";
import { GET } from "../app/api/judge/status/route";
import { PracticeResult, type PracticeExecution } from "./room/practice-result";

const mocks = vi.hoisted(() => ({ service: vi.fn(), rows: vi.fn(), token: "synthetic-token" }));
vi.mock("./auth-provider", () => ({ useAuth: () => ({ session: { access_token: mocks.token, user: { id: "owner" } } }) }));
vi.mock("../lib/server/supabase-admin", () => ({ getSupabaseAdmin: () => ({ auth: {
  getUser: async (token: string) => ({ data: { user: ["synthetic-token", "refreshed-token"].includes(token) ? { id: "owner" } : null }, error: null }),
} }) }));
vi.mock("../lib/server/judge/context", () => ({ getJudgeService: (...args: unknown[]) => mocks.service(...args) }));
vi.mock("../lib/supabase", () => ({ supabase: { from: () => {
  const query = {
    select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mocks.rows(), error: null }).then(resolve),
  };
  return query;
} } }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  mocks.token = "synthetic-token";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const problemId = "11111111-1111-4111-8111-111111111111";
const imported = `import java.util.Stack;
class Solution {
  public static boolean isBalanced(String signal) {
    Stack<Character> stack = new Stack<>();
    for (char c : signal.toCharArray()) {
      if (c == '(' || c == '[' || c == '{') { stack.push(c); }
      else {
        if (stack.isEmpty()) return false;
        char top = stack.pop();
        if ((c == ')' && top != '(') || (c == ']' && top != '[') || (c == '}' && top != '{')) return false;
      }
    }
    return stack.isEmpty();
  }
}`;
const qualified = imported.replace("import java.util.Stack;\n", "").replaceAll("Stack", "java.util.Stack");
// Bracket Beacon's curated fixture contract: nested, crossed, empty, unclosed.
const harness = `class Main {
  public static void main(String[] args) {
    System.out.println(Solution.isBalanced("{[()]}"));
    System.out.println(Solution.isBalanced("[(])"));
    System.out.println(Solution.isBalanced(""));
    System.out.println(Solution.isBalanced("(()"));
  }
}`;

function setup(providerOutput = "true\nfalse\ntrue\nfalse\n", configured = true, providerError?: string) {
  let stored: StoredSubmission | null = null;
  const quota = { used: 0, limit: 20, remaining: 20, active: 0, resetAt: new Date(Date.now() + 3_600_000).toISOString() };
  const repository: JudgeRepository = {
    readQuota: vi.fn(async () => null),
    getConfig: vi.fn(async () => ({ problemId, fixtureVersion: 1, harnessSource: harness,
      expectedOutput: ["true", "false", "true", "false"], fallback: null })),
    getQuota: vi.fn(async () => ({ ...quota })),
    reserve: vi.fn<JudgeRepository["reserve"]>(async () => {
      quota.used += 1; quota.remaining -= 1; quota.active += 1;
      return { result: "reserved", submissionId: "22222222-2222-4222-8222-222222222222", quota: { ...quota } };
    }),
    hasSubmissionKey: vi.fn(async () => false),
    getSubmission: vi.fn(async () => stored),
    complete: vi.fn(async completion => {
      quota.active -= 1;
      stored = { id: completion.submissionId, problemId, language: "java", verification: "leetcollab",
        judgeState: completion.judgeState, verdict: completion.verdict, testsPassed: completion.testsPassed,
        testsTotal: completion.testsTotal, durationMs: completion.durationMs, diagnostics: completion.diagnostics,
        createdAt: "2026-11-18T00:00:00.000Z" };
      return { submission: stored, quota: { ...quota }, applied: true };
    }),
    exhaust: vi.fn(async () => ({ ...quota })),
  };
  // Only the external transport and persistence boundaries are synthetic. No Java executes.
  const send = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify({ output: providerOutput, error: providerError ?? "",
    status: providerError ? "error" : "success", exit_code: providerError ? 1 : 0, signal: null, truncated: false })));
  const service = new JudgeService(repository, new OnlineCompilerProvider({ apiKey: "synthetic-key",
    policyAccepted: true, executionApproved: configured, fetch: send }));
  mocks.service.mockReturnValue(service);
  mocks.rows.mockReturnValue([]);
  const responses: Response[] = [];
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    const request = new Request(`https://app.test${url}`, options);
    const response = options?.method === "POST" ? await POST(request) : await GET(request);
    if (options?.method === "POST") responses.push(response.clone());
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return { repository, send, responses, fetch };
}

async function click(label: string, source: string) {
  function Harness() {
    const [execution, setExecution] = useState<PracticeExecution | null>(null);
    return <><PracticeControls problemId={problemId} code={source} onExecutionChange={setExecution} /><PracticeResult execution={execution} /></>;
  }
  await act(async () => { renderer = create(<Harness />); });
  const button = renderer!.root.findAllByType("button").find(node => node.children.includes(label))!;
  expect(button.props.disabled).toBe(false);
  await act(async () => { await button.props.onClick(); });
}
const output = () => JSON.stringify(renderer!.toJSON());

it.each(["Run", "Submit"])("%s accepts the imported Bracket Beacon solution through the real HTTP/service/adapter path", async label => {
  const { repository, send, responses } = setup();
  await click(label, imported);
  expect(responses[0].status).toBe(200);
  expect(await responses[0].json()).toMatchObject({ ok: true, submission: {
    verdict: "accepted", testsPassed: 4, testsTotal: 4, verification: "leetcollab",
  }, quota: { used: 1, active: 0 } });
  expect(repository.reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", sourceCode: imported, runner: "onlinecompiler" }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toEqual({
    compiler: "openjdk-25", code: `${imported}\n\n${harness.replace("class Main", "public class Main")}\n`,
  });
  expect(renderer!.root.findByType("h2").children).toEqual(["Accepted"]);
  expect(output()).toContain("Not solved");
  expect(output()).not.toContain("isBalanced");
});

it.each(["Run", "Submit"])("%s finishes across same-user token refresh and reloads current quota", async label => {
  const { fetch, send } = setup();
  let finish!: (response: Response) => void;
  send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  function Harness() {
    const [execution, setExecution] = useState<PracticeExecution | null>(null);
    return <><PracticeControls problemId={problemId} code={imported} onExecutionChange={setExecution} /><PracticeResult execution={execution} /></>;
  }
  await act(async () => { renderer = create(<Harness />); });
  const button = renderer!.root.findAllByType("button").find(node => node.children.includes(label))!;
  let pending!: Promise<void>;
  await act(async () => { pending = button.props.onClick(); });
  expect(output()).toContain("Judging solution");
  mocks.token = "refreshed-token";
  await act(async () => { renderer!.update(<Harness />); });
  await act(async () => {
    finish(new Response(JSON.stringify({ output: "true\nfalse\ntrue\nfalse\n", error: "",
      status: "success", exit_code: 0, signal: null, truncated: false })));
    await pending;
  });
  expect(renderer!.root.findByType("h2").children).toEqual(["Accepted"]);
  expect(fetch).toHaveBeenLastCalledWith(`/api/judge/status?problemId=${problemId}`, {
    headers: { Authorization: "Bearer refreshed-token" },
  });
});

it.each([
  ["qualified", qualified],
  ["unused import", `import java.util.Stack;\n${qualified}`],
] as const)("accepts the %s counterfactual through the same route", async (_name, source) => {
  const { responses, send } = setup();
  await click("Run", source);
  expect(responses[0].status).toBe(200);
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0][1]!.body as string).code)
    .toBe(`${source}\n\n${harness.replace("class Main", "public class Main")}\n`);
});

it.each(["Run", "Submit"])("%s still rejects forbidden imports before quota reservation or transport", async label => {
  const { repository, send, responses } = setup();
  await click(label, imported.replace("java.util.Stack", "java.io.File"));
  expect(responses[0].status).toBe(400);
  expect(await responses[0].json()).toMatchObject({ ok: false, error: { code: "UNSAFE_SOURCE" } });
  expect(repository.reserve).not.toHaveBeenCalled();
  expect(repository.complete).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(output()).toContain("Not solved");
  expect(renderer!.root.findByType("h2").children).toEqual(["Submission Rejected"]);
  expect(output()).toContain("File and network APIs are not supported.");
});

it.each(["Run", "Submit"])("%s keeps server fixture comparison authoritative for imported source", async label => {
  const { responses } = setup("true\ntrue\ntrue\ntrue\n");
  await click(label, imported);
  expect(responses[0].status).toBe(200);
  expect(await responses[0].json()).toMatchObject({ ok: true, submission: { verdict: "wrong_answer", testsPassed: 2, testsTotal: 4 } });
  expect(output()).toContain("Not solved");
  expect(renderer!.root.findByType("h2").children).toEqual(["Wrong Answer"]);
});

it("retains the provider approval gate for imported source sent directly to the endpoint", async () => {
  const { repository, send } = setup(undefined, false);
  const result = await POST(new Request("https://app.test/api/judge/submissions", { method: "POST",
    headers: { authorization: "Bearer synthetic-token" }, body: JSON.stringify({ problemId, language: "java",
      sourceCode: imported, idempotencyKey: "33333333-3333-4333-8333-333333333333" }) }));
  expect(result.status).toBe(503);
  expect(repository.reserve).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it.each(["Run", "Submit"])("%s displays safe missing-import compiler feedback from the real route/service/adapter path", async label => {
  const missingImport = imported.replace("import java.util.Stack;\n", "");
  const { responses, repository } = setup("", true, "Main.java:3: error: cannot find symbol\n"
    + "Stack<Character> stack = new Stack<>();\n symbol: class Stack\n"
    + "Main.java:90: error: incompatible types: PRIVATE_FIXTURE_LITERAL\nsecret harness echo\n");
  await click(label, missingImport);
  expect(responses[0].status).toBe(200);
  const body = await responses[0].json();
  expect(body).toMatchObject({ ok: true, submission: {
    verdict: "compile_error", diagnostics: "Line 3: Cannot find symbol. Check spelling and imports.",
    compilerDiagnostics: [{ line: 3, message: "Cannot find symbol. Check spelling and imports." }],
    compilerErrorCount: null, compilerDiagnosticsComplete: false,
  } });
  expect(JSON.stringify(body)).not.toContain("Stack<Character>");
  expect(renderer!.root.findByType("h2").children).toEqual(["Compile Error"]);
  expect(output()).toContain("Cannot find symbol. Check spelling and imports.");
  expect(output()).not.toMatch(/PRIVATE_FIXTURE|secret harness/);
  expect(output()).toContain("Stack<Character>");
  expect(repository.complete).toHaveBeenCalledWith(expect.objectContaining({
    diagnostics: "Line 3: Cannot find symbol. Check spelling and imports.",
  }));
});
