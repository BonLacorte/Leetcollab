import { expect, it } from "vitest";
import { EditorState } from "@uiw/react-codemirror";
import { diagnosticCount, setDiagnostics } from "@codemirror/lint";
import { clearCompilerDiagnosticsOnEdit, editorDiagnostics } from "./editor-diagnostics";
import type { PracticeExecution } from "./practice-result";
import type { StructuredSubmission } from "./execution-feedback";

const problemId = "11111111-1111-4111-8111-111111111111";
const source = "class Solution {\n  static int answer() {\n    return 12\n  }\n}";
const submission: StructuredSubmission = { id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verdict: "compile_error",
  verification: "leetcollab", testsPassed: 0, testsTotal: 4, durationMs: 10, diagnostics: "Compile failure", createdAt: "2026-11-18T03:00:00.000Z",
  compilerDiagnostics: [{ line: 3, message: "Expected a semicolon (;)." }], compilerErrorCount: 1, compilerDiagnosticsComplete: true };
const execution: PracticeExecution = { action: "Run", sourceCode: source, codeVersion: 5, state: "finished", response: {
  ok: true, submission, quota: { used: 1, limit: 50, remaining: 49, active: 0, resetAt: "2026-11-18T23:55:00.000Z" },
} };

it("marks the full reported line in the matching editor revision", () => {
  const state = EditorState.create({ doc: source });
  const markers = editorDiagnostics(state, execution, problemId, source, 5);
  expect(markers).toHaveLength(1);
  expect(markers[0]).toMatchObject({ from: state.doc.line(3).from, to: state.doc.line(3).to, severity: "error", message: "Expected a semicolon (;)." });
});

it("does not apply stale markers after an edit, reset/retrieve, or exercise switch", () => {
  const state = EditorState.create({ doc: source });
  expect(editorDiagnostics(state, execution, problemId, source, 6)).toEqual([]);
  expect(editorDiagnostics(EditorState.create({ doc: source + "\n// edit" }), execution, problemId, source + "\n// edit", 5)).toEqual([]);
  expect(editorDiagnostics(state, execution, "different-problem", source, 5)).toEqual([]);
  expect(editorDiagnostics(state, null, problemId, source, 5)).toEqual([]);
});

it("clears markers in the same transaction as a local or external document edit", () => {
  let state = EditorState.create({ doc: source, extensions: [clearCompilerDiagnosticsOnEdit] });
  state = state.update(setDiagnostics(state, editorDiagnostics(state, execution, problemId, source, 5))).state;
  expect(diagnosticCount(state)).toBe(1);
  state = state.update({ changes: { from: 0, insert: "// newer edit\n" } }).state;
  expect(diagnosticCount(state)).toBe(0);
});

it("maps CRLF source lines onto CodeMirror's normalized document", () => {
  const crlf = source.replaceAll("\n", "\r\n");
  const state = EditorState.create({ doc: crlf });
  expect(editorDiagnostics(state, { ...execution, sourceCode: crlf }, problemId, crlf, 5)).toHaveLength(1);
});

it("ignores out-of-source locations while keeping the valid line marker", () => {
  const state = EditorState.create({ doc: source });
  const value: StructuredSubmission = { ...submission, compilerDiagnostics: [{ line: 3, message: "Missing semicolon" }, { line: 900, message: "PRIVATE_HARNESS" }] };
  const result = { ...execution, state: "finished" as const, response: { ...execution.response, ok: true as const, submission: value, quota: { used: 1, limit: 50, remaining: 49, active: 0, resetAt: "2026-11-18T23:55:00.000Z" } } };
  expect(editorDiagnostics(state, result, problemId, source, 5)).toEqual([{ from: state.doc.line(3).from, to: state.doc.line(3).to, severity: "error", source: "Java compiler", message: "Missing semicolon" }]);
});
