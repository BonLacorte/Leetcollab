import type { JudgeCompilerDiagnostic, JudgePublicCase, JudgeSubmission } from "@leetcollab/contracts";

export type CodeDiagnostic = JudgeCompilerDiagnostic;
export type PublicCase = JudgePublicCase;
export type StructuredSubmission = JudgeSubmission;

export function sourceDiagnostics(submission: StructuredSubmission, source: string): CodeDiagnostic[] {
  const lines = source.split(/\r\n?|\n/);
  return (submission.compilerDiagnostics ?? []).flatMap(diagnostic => {
    if (!Number.isSafeInteger(diagnostic.line) || diagnostic.line < 1 || diagnostic.line > lines.length) return [];
    const suppliedColumn = diagnostic.column;
    const column = typeof suppliedColumn === "number" && Number.isSafeInteger(suppliedColumn) && suppliedColumn > 0 && suppliedColumn <= lines[diagnostic.line - 1].length + 1
      ? suppliedColumn : null;
    return [{ line: diagnostic.line, column, message: diagnostic.message }];
  });
}

export function compilerCountLabel(submission: StructuredSubmission, available: number): string {
  const total = submission.compilerErrorCount;
  if (typeof total === "number" && Number.isSafeInteger(total) && total >= available && total > 0) {
    const reported = `${total} compiler ${total === 1 ? "error" : "errors"}`;
    return submission.compilerDiagnosticsComplete === true && total === available
      ? reported : `${reported} · ${available} source ${available === 1 ? "diagnostic" : "diagnostics"} available`;
  }
  return available ? `${available} source ${available === 1 ? "diagnostic" : "diagnostics"} available · Compiler total not provided`
    : "Detailed error locations and compiler total are unavailable.";
}
