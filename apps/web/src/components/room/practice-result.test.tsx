// @vitest-environment jsdom
import React, { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EditorPanel } from "./editor-panel";
import { WorkspacePanel } from "./workspace-panel";
import type { PracticeExecution } from "./practice-result";

vi.mock("../theme-provider", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@uiw/react-codemirror", async importOriginal => ({
  ...await importOriginal<typeof import("@uiw/react-codemirror")>(),
  default: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));
vi.mock("../auth-provider", () => ({ useAuth: () => ({ session: { access_token: "token", user: { id: "user" } } }) }));
vi.mock("../../lib/supabase", () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
  return query;
}, rpc: async () => ({ data: [] }) } }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const noop = () => {};
const workspaceProps: ComponentProps<typeof WorkspacePanel> = {
  problem: null, canvasRef: { current: null }, canDrawWhiteboard: true, drawing: false,
  whiteboardMode: "pen", whiteboardColor: "#000000", whiteboardSize: 3, whiteboardScale: 1,
  whiteboardCursor: { visible: false, x: 0, y: 0, diameter: 3 },
  onClearWhiteboard: noop, onUndoWhiteboard: noop, onModeChange: noop, onColorChange: noop,
  onSizeChange: noop, onPointerDown: noop, onPointerMove: noop, onPointerEnd: noop, onPointerLeave: noop,
  onWheel: noop, onZoomIn: noop, onZoomOut: noop, onResetView: noop, execution: null,
};
const quota = { available: true, used: 0, limit: 20, remaining: 20, active: 0,
  resetAt: new Date(Date.now() + 3_600_000).toISOString(), fallback: null, unavailableReason: null };
const problemId = "11111111-1111-4111-8111-111111111111";
const response = (body: unknown) => new Response(JSON.stringify(body));
function Harness({ code }: { code: string }) {
  const [execution, setExecution] = useState<PracticeExecution | null>(null);
  return <><EditorPanel problemId={problemId} code={code} codeVersion={0} execution={execution}
    canEditCode connected progress={null} progressStatus="" isProgressLoading={false} isRetrievingSubmission={false}
    onCodeChange={noop} onResetCode={noop} onRestoreDraft={noop} onRetrieveSubmission={noop} onExecutionChange={setExecution} />
    <WorkspacePanel {...workspaceProps} execution={execution} /></>;
}
async function render(code = "class Solution {}") {
  container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<Harness code={code} />); });
}
async function click(label: string, role?: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>(role ? `[role="${role}"]` : "button"))
    .find(node => node.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button.click();
  });
}
const resultPanel = () => container.querySelector('[role="tabpanel"][data-state="active"]')!;

it.each(["Run", "Submit"])("%s opens Result, renders compiler feedback there, and preserves the whiteboard", async label => {
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method
    ? new Promise<Response>(resolve => { finish = resolve; }) : response(quota)));
  await render();
  const canvas = container.querySelector("canvas");
  const editor = container.querySelector(".editor-panel textarea");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Maximize Code card"]')!.click());
  expect(container.querySelector(".editor-panel")?.getAttribute("data-view")).toBe("maximized");
  await click(label);
  expect(container.querySelector(".editor-panel")?.getAttribute("data-view")).toBe("normal");
  expect(container.querySelector(".editor-panel textarea")).toBe(editor);
  expect(resultPanel().textContent).toContain("Judging");
  await click("Whiteboard", "tab");
  await act(async () => finish(response({ ok: true, quota, submission: {
    id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verification: "leetcollab",
    verdict: "compile_error", testsPassed: 0, testsTotal: 4, durationMs: 10,
    diagnostics: "Line 3: Cannot find symbol. Check spelling and imports.", createdAt: "2026-11-18T03:00:00.000Z",
  } })));
  expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("Whiteboard");
  await click("Result", "tab");
  expect(resultPanel().textContent).toContain("Compile Error");
  expect(resultPanel().textContent).toContain("Line 3: Cannot find symbol.");
  expect(container.querySelector(".practice-controls")!.textContent).not.toContain("Cannot find symbol");
  expect(container.querySelector(".practice-controls")!.textContent).not.toContain("LeetCollab verdict");
  await click("Whiteboard", "tab");
  expect(container.querySelector("canvas")).toBe(canvas);
  await click("Refresh status");
  expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("Whiteboard");
  await click("again1 day");
  expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("Whiteboard");
  await click("Result", "tab");
  expect(resultPanel().textContent).toContain("Compile Error");
});

it.each([
  ["validation", { ok: false, error: { code: "UNSAFE_SOURCE", message: "File and network APIs are not supported." } }, "Submission Rejected", "File and network APIs"],
  ["accepted", { ok: true, quota, submission: {
    id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verification: "leetcollab",
    verdict: "accepted", testsPassed: 4, testsTotal: 4, durationMs: 10, diagnostics: null, createdAt: "2026-11-18T03:00:00.000Z",
  } }, "Accepted", "4 of 4"],
  ["malformed", { unexpected: "body" }, "Judge Unavailable", "Refresh status"],
] as const)("shows %s feedback inside Result", async (_name, body, title, detail) => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => response(options?.method ? body : quota)));
  await render();
  await click("Submit");
  expect(resultPanel().textContent).toContain(title);
  expect(resultPanel().textContent).toContain(detail);
});

it("keeps structured compiler locations through API parsing and uses the submitted source excerpt", async () => {
  const code = "class Solution {\n  int answer() {\n    return 12\n  }\n}";
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => response(options?.method ? { ok: true, quota, submission: {
    id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verification: "leetcollab", verdict: "compile_error",
    testsPassed: 0, testsTotal: 4, durationMs: 10, diagnostics: "Compile failure",
    compilerDiagnostics: [{ line: 3, message: "Expected a semicolon (;)." }], compilerErrorCount: 1, compilerDiagnosticsComplete: true,
    createdAt: "2026-11-18T03:00:00.000Z",
  } } : quota)));
  await render(code);
  await click("Run");
  expect(resultPanel().querySelector(".compiler-source")?.textContent).toBe("    return 12");
  expect(resultPanel().querySelector(".compiler-error-count")?.textContent).toBe("1 compiler error");
});

it.each([true, false])("keeps actual public case details through API parsing (passed=%s)", async passed => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => response(options?.method ? { ok: true, quota, submission: {
    id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verification: "leetcollab", verdict: passed ? "accepted" : "wrong_answer",
    testsPassed: passed ? 4 : 2, testsTotal: 4, durationMs: 10, diagnostics: "Aggregate verdict",
    publicCases: [{ id: "example-1", title: "Public example", input: "public input", output: passed ? "true" : "false", expected: "true", passed }],
    createdAt: "2026-11-18T03:00:00.000Z",
  } } : quota)));
  await render();
  await click("Submit");
  const panel = resultPanel().querySelector('.public-case-detail[data-state="active"]')!;
  expect(Array.from(panel.querySelectorAll("pre"), node => node.textContent)).toEqual(["public input", passed ? "true" : "false", "true"]);
  expect(panel.textContent).toContain(passed ? "Passed" : "Failed");
});
