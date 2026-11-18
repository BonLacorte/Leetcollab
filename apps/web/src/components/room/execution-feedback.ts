import type { JudgeSubmission } from "@leetcollab/contracts";

// Optional projection shared with the server owner. Old saved responses remain
// usable through their aggregate verdict and plain diagnostics.
export type CodeDiagnostic = { line: number; column?: number | null; message: string };
export type PublicCase = {
  id: string; title: string; input: string; output: string | null; expected: string; passed: boolean | null;
};
export type StructuredSubmission = JudgeSubmission & {
  compilerDiagnostics?: CodeDiagnostic[];
  compilerErrorCount?: number | null;
  compilerDiagnosticsComplete?: boolean;
  publicCases?: PublicCase[];
};

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
