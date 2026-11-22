import type { JudgeCompilerDiagnostic, JudgeSubmission } from "@leetcollab/contracts";

export function sourceDiagnostics(submission: JudgeSubmission, source: string): JudgeCompilerDiagnostic[] {
  const lines = source.split(/\r\n?|\n/);
  return (submission.compilerDiagnostics ?? []).filter(({ line }) =>
    Number.isSafeInteger(line) && line >= 1 && line <= lines.length);
}

export function compilerCountLabel(submission: JudgeSubmission, available: number): string {
  const total = submission.compilerErrorCount;
  if (typeof total === "number" && Number.isSafeInteger(total) && total >= available && total > 0) {
    const reported = `${total} compiler ${total === 1 ? "error" : "errors"}`;
    return submission.compilerDiagnosticsComplete === true && total === available
      ? reported : `${reported} · ${available} source ${available === 1 ? "diagnostic" : "diagnostics"} available`;
  }
  return available ? `${available} source ${available === 1 ? "diagnostic" : "diagnostics"} available · Compiler total not provided`
    : "Detailed error locations and compiler total are unavailable.";
}
