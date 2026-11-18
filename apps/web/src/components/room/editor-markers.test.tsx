// @vitest-environment jsdom
import React, { act, useState, type ComponentProps } from "react";
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

it("preserves the real editor, selection and diagnostics through fold, maximize and restore", async () => {
  const container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<EditorPanel {...props} />); });
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  await act(async () => view.dispatch({ selection: { anchor: 20 } }));
  const doc = view.state.doc;
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(async () => button("Fold Code card").click());
  expect(container.querySelector<HTMLDivElement>(".editor-content")!.hidden).toBe(true);
  expect(button("Unfold Code card").getAttribute("aria-expanded")).toBe("false");
  expect(EditorView.findFromDOM(container.querySelector(".cm-editor")!)).toBe(view);
  await act(async () => button("Unfold Code card").click());
  await act(async () => button("Maximize Code card").click());
  expect(container.querySelector(".editor-panel")?.getAttribute("data-view")).toBe("maximized");
  expect(button("Minimize Code card").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Minimize Code card").click());
  expect(container.querySelector(".editor-panel")?.getAttribute("data-view")).toBe("normal");
  await act(async () => button("Fold Code card").click());
  await act(async () => button("Maximize Code card").click());
  expect(container.querySelector<HTMLDivElement>(".editor-content")!.hidden).toBe(false);
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(container.querySelector(".editor-panel")?.getAttribute("data-view")).toBe("normal");
  await act(async () => root.render(<EditorPanel {...props} progressStatus="Draft autosaved." />));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(view.state.doc).toBe(doc);
  expect(view.state.selection.main.anchor).toBe(20);
  expect(diagnosticCount(view.state)).toBe(1);
});

it("keeps typed code and undo history while changing the Code card view", async () => {
  function Harness() {
    const [value, setValue] = useState(code);
    const [version, setVersion] = useState(5);
    return <EditorPanel {...props} code={value} codeVersion={version} onCodeChange={next => { setValue(next); setVersion(current => current + 1); }} />;
  }
  const container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<Harness />); });
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  await act(async () => view.dispatch({ changes: { from: 0, insert: "// typed code\n" } }));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Maximize Code card"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Fold Code card"]')!.click());
  expect(container.querySelector(".editor-panel")?.getAttribute("data-view")).toBe("folded");
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Unfold Code card"]')!.click());
  expect(view.state.doc.toString()).toBe("// typed code\n" + code);
  await act(async () => { view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true })); });
  expect(view.state.doc.toString()).toBe(code);
});
