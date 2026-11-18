import { EditorState } from "@uiw/react-codemirror";
import { setDiagnosticsEffect, type Diagnostic } from "@codemirror/lint";
import { sourceDiagnostics } from "./execution-feedback";
import type { PracticeExecution } from "./practice-result";

// Clear in the same editor transaction, before old positions can be mapped onto
// newly typed or remotely replaced text. No compiler request is made here.
export const clearCompilerDiagnosticsOnEdit = EditorState.transactionExtender.of(transaction =>
  transaction.docChanged ? { effects: setDiagnosticsEffect.of([]) } : null);

export function editorDiagnostics(
  state: EditorState, execution: PracticeExecution | null, problemId: string | null, code: string, codeVersion: number,
): Diagnostic[] {
  if (!execution || execution.state !== "finished" || !execution.response.ok
    || execution.response.submission.verdict !== "compile_error" || execution.response.submission.problemId !== problemId
    || execution.sourceCode !== code || execution.codeVersion !== codeVersion
    || state.doc.toString() !== code.replace(/\r\n?|\n/g, "\n")) return [];

  return sourceDiagnostics(execution.response.submission, execution.sourceCode).map(diagnostic => {
    const line = state.doc.line(diagnostic.line);
    const from = diagnostic.column ? line.from + diagnostic.column - 1 : line.from;
    const width = (line.text.codePointAt(from - line.from) ?? 0) > 0xffff ? 2 : 1;
    return { from, to: diagnostic.column ? Math.min(line.to, from + width) : line.to,
      severity: "error", source: "Java compiler", message: diagnostic.message };
  });
}
