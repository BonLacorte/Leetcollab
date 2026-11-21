import type { JudgeCompilerDiagnostic, JudgeSubmission, JudgeVerdict } from "@leetcollab/contracts";

export type CompilerDiagnostic = JudgeCompilerDiagnostic;
export type CompilerReport = Required<Pick<JudgeSubmission,
  "compilerDiagnostics" | "compilerErrorCount" | "compilerDiagnosticsComplete">>;

// Compiler output can echo private harness source, literals, paths and runtime
// values. Only these locally written messages may cross the public boundary.
const categories: Array<[RegExp, string]> = [
  [/^cannot find symbol$/, "Cannot find symbol. Check spelling and imports."],
  [/^incompatible types:/, "Incompatible types. Check declarations and return values."],
  [/^missing return statement$/, "Missing return statement."],
  [/^';' expected$/, "Expected a semicolon (;)."],
  [/^'\}' expected$/, "Expected a closing brace (})."],
  [/^'\)' expected$/, "Expected a closing parenthesis: )."],
  [/^'\(' expected$/, "Expected an opening parenthesis: (."],
  [/^'\]' expected$/, "Expected a closing bracket (])."],
  [/^illegal start of expression$/, "Illegal start of expression. Check syntax and braces."],
  [/^illegal start of type$/, "Illegal start of type. Check syntax and braces."],
  [/^statements not expected outside of methods and initializers$/, "Statement outside a method or initializer. Check brace placement."],
  [/^class, interface, (?:enum, or record|or enum|annotation type, enum, record, method or field) expected$/, "Expected a class or other declaration. Check braces."],
  [/^reached end of file while parsing$/, "Reached the end of the file while parsing. Check closing braces."],
  [/^not a statement$/, "Not a valid Java statement."],
  [/^unclosed string literal$/, "Unclosed string literal."],
  [/^unclosed character literal$/, "Unclosed character literal."],
  [/^illegal escape character$/, "Illegal escape character."],
  [/^method .+ cannot be applied to given types;?$/, "Method arguments do not match the method signature."],
  [/^.+ is already defined in .+$/, "Duplicate declaration. Check class, method and variable names."],
  [/^non-static .+ cannot be referenced from a static context$/, "A non-static member was used from a static context."],
];
const unknownCompilerMessage = "Java compilation failed. Detailed compiler diagnostics are unavailable.";
const allowedMessages = new Set([...categories.map(([, message]) => message), unknownCompilerMessage]);

const compilerHeader = /^(?:[^\r\n]*[/\\])?(?:Main|code|Solution)\.java:([1-9]\d*)(?::\d+)?:\s*error:\s*(.*)$/;

export function hasCompilerLocation(output: string): boolean {
  return output.split(/\r\n?|\n/).some(line => compilerHeader.test(line));
}

export function compilerReport(output: string): CompilerReport {
  const diagnostics: CompilerDiagnostic[] = [];
  let headers = 0;
  for (const line of output.slice(0, 8192).split(/\r\n?|\n/)) {
    const header = compilerHeader.exec(line);
    if (!header) continue;
    headers += 1;
    const message = categories.find(([pattern]) => pattern.test(header[2].trim()))?.[1] ?? unknownCompilerMessage;
    const number = Number(header[1]);
    if (Number.isSafeInteger(number) && diagnostics.length < 8) diagnostics.push({ line: number, message });
  }
  // Only an explicit terminal javac summary is a reported total. A count of
  // matched headers is never substituted for the compiler's actual total.
  const summary = /(?:^|\n)([1-9]\d*) errors?\s*$/.exec(output.replace(/\r\n?/g, "\n"));
  const count = summary ? Number(summary[1]) : null;
  const reported = count !== null && Number.isSafeInteger(count) && count >= headers ? count : null;
  return {
    compilerDiagnostics: diagnostics,
    compilerErrorCount: reported,
    compilerDiagnosticsComplete: output.length <= 8192 && reported !== null && reported === diagnostics.length && headers === diagnostics.length,
  };
}

export function publicCompilerReport(
  source: string, output: string | null, issues?: CompilerDiagnostic[],
  errorCount: number | null = null, complete = false,
): CompilerReport {
  const report = issues === undefined ? compilerReport(output ?? "") : {
    compilerDiagnostics: issues,
    compilerErrorCount: errorCount,
    compilerDiagnosticsComplete: complete,
  };
  const compiledLines = source.trim().split(/\r\n?|\n/).length;
  const leadingLines = source.slice(0, source.length - source.trimStart().length).split(/\r\n?|\n/).length - 1;
  const mapped = report.compilerDiagnostics
    .filter(issue => Number.isSafeInteger(issue.line) && issue.line > 0 && issue.line <= compiledLines && allowedMessages.has(issue.message))
    .map(issue => ({ line: issue.line + leadingLines, message: issue.message }));
  return {
    compilerDiagnostics: mapped.slice(0, 8),
    compilerErrorCount: report.compilerErrorCount,
    compilerDiagnosticsComplete: report.compilerDiagnosticsComplete && mapped.length <= 8
      && mapped.length === report.compilerDiagnostics.length && report.compilerErrorCount === mapped.length
      && mapped.every(issue => issue.message !== unknownCompilerMessage),
  };
}

export function compilerSummary(issues: CompilerDiagnostic[]): string {
  return issues.map(issue => `Line ${issue.line}: ${issue.message}`).join("\n") || unknownCompilerMessage;
}

export function publicExecutionDiagnostics(verdict: JudgeVerdict, source: string, storedSummary: string | null): string {
  if (verdict === "compile_error") {
    const sourceLines = source.split(/\r\n?|\n/).length;
    const stored = (storedSummary ?? "").slice(0, 8192).split(/\r\n?|\n/).flatMap(line => {
      const match = /^Line ([1-9]\d*): (.+)$/.exec(line);
      return match && Number(match[1]) <= sourceLines && allowedMessages.has(match[2])
        ? [{ line: Number(match[1]), message: match[2] }] : [];
    });
    return compilerSummary(stored.slice(0, 8));
  }
  switch (verdict) {
    case "runtime_error": return "The Java program stopped with a runtime error.";
    case "time_limit": return "The Java program exceeded the sandbox time limit.";
    case "memory_limit": return "The Java program exceeded the sandbox memory limit.";
    case "output_limit": return "The program or sandbox response exceeded the output limit.";
    default: return "No further diagnostics were returned.";
  }
}
