// @vitest-environment jsdom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorView } from "@uiw/react-codemirror";
import { diagnosticCount } from "@codemirror/lint";
import { EditorPanel } from "./editor-panel";
import type { StructuredSubmission } from "./execution-feedback";

vi.mock("../theme-provider", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("../practice-controls", () => ({ PracticeControls: () => <div>Judge controls</div> }));
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(0, 0, 0, 0) });

const code = "class Solution {\n  static int answer() {\n    return 12\n  }\n}";
const problemId = "11111111-1111-4111-8111-111111111111";
const submission: StructuredSubmission = { id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verdict: "compile_error",
  verification: "leetcollab", testsPassed: 0, testsTotal: 4, durationMs: 10, diagnostics: "Compile failure", createdAt: "2026-11-18T03:00:00.000Z",
  compilerDiagnostics: [{ line: 3, column: 12, message: "Expected a semicolon (;)." }], compilerErrorCount: 1, compilerDiagnosticsComplete: true };
const props: ComponentProps<typeof EditorPanel> = {
  problemId, code, codeVersion: 5, execution: { action: "Run", sourceCode: code, codeVersion: 5, state: "finished", response: {
    ok: true, submission, quota: { used: 1, limit: 50, remaining: 49, active: 0, resetAt: "2026-11-18T23:55:00.000Z" },
  } }, canEditCode: true, progress: null, progressStatus: "", isProgressLoading: false, isRetrievingSubmission: false, connected: true,
  onCodeChange: () => {}, onResetCode: () => {}, onRetrieveSubmission: () => {}, onExecutionChange: () => {},
};
let root: Root;
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await act(async () => { root?.unmount(); await vi.advanceTimersByTimeAsync(1000); });
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("renders a real CodeMirror gutter marker and clears it immediately on document changes", async () => {
  const container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<EditorPanel {...props} />); });
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  expect(diagnosticCount(view.state)).toBe(1);
  expect(container.querySelector(".cm-lintRange-error")).not.toBeNull();
  expect(container.querySelector(".cm-gutter-lint")).not.toBeNull();
  await act(async () => { view.dispatch({ changes: { from: 0, insert: "// edited\n" } }); });
  expect(diagnosticCount(view.state)).toBe(0);
  expect(container.querySelector(".cm-lintRange-error")).toBeNull();
  await act(async () => root.render(<EditorPanel {...props} code={"// edited\n" + code} codeVersion={6} />));
  await act(async () => root.render(<EditorPanel {...props} codeVersion={7} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(view.state.doc.toString()).toBe(code);
  expect(diagnosticCount(view.state)).toBe(0);
});

it("does not mark edited code when an older pending result finishes", async () => {
  const container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<EditorPanel {...props} execution={{ action: "Run", sourceCode: code, codeVersion: 5, state: "running" }} />); });
  await act(async () => root.render(<EditorPanel {...props} code={code + "\n// newer code"} codeVersion={6} />));
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  expect(diagnosticCount(view.state)).toBe(0);
  expect(container.querySelector(".cm-lintRange-error")).toBeNull();
});
