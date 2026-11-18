import type { JudgeVerdict } from "@leetcollab/contracts";

export type CompilerDiagnostic = { line: number; message: string };

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

export function compilerDiagnostics(output: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  for (const line of output.slice(0, 8192).split(/\r\n?|\n/)) {
    const header = /^(?:[^\r\n]*[/\\])?(?:Main|code|Solution)\.java:([1-9]\d*)(?::\d+)?:\s*error:\s*(.*)$/.exec(line);
    if (!header) continue;
    const message = categories.find(([pattern]) => pattern.test(header[2].trim()))?.[1] ?? unknownCompilerMessage;
    const number = Number(header[1]);
    if (Number.isSafeInteger(number)) diagnostics.push({ line: number, message });
    if (diagnostics.length === 8) break;
  }
  return diagnostics;
}

export function publicExecutionDiagnostics(
  verdict: JudgeVerdict,
  source: string,
  output: string | null,
  issues?: CompilerDiagnostic[],
): string {
  if (verdict === "compile_error") {
    const sourceLines = source.split(/\r\n?|\n/).length;
    // Idempotent reads may contain our already mapped, persisted messages.
    const stored = (output ?? "").slice(0, 8192).split(/\r\n?|\n/).flatMap(line => {
      const match = /^Line ([1-9]\d*): (.+)$/.exec(line);
      return match && Number(match[1]) <= sourceLines && allowedMessages.has(match[2])
        ? [{ line: Number(match[1]), message: match[2] }] : [];
    });
    const compiledLines = source.trim().split(/\r\n?|\n/).length;
    const leadingLines = source.slice(0, source.length - source.trimStart().length).split(/\r\n?|\n/).length - 1;
    const safe = stored.length ? stored : (issues ?? compilerDiagnostics(output ?? ""))
      .filter(issue => Number.isSafeInteger(issue.line) && issue.line > 0 && issue.line <= compiledLines && allowedMessages.has(issue.message))
      .map(issue => ({ ...issue, line: issue.line + leadingLines }));
    return [...new Set(safe.slice(0, 8).map(issue => `Line ${issue.line}: ${issue.message}`))].join("\n") || unknownCompilerMessage;
  }
  switch (verdict) {
    case "runtime_error": return "The Java program stopped with a runtime error.";
    case "time_limit": return "The Java program exceeded the sandbox time limit.";
    case "memory_limit": return "The Java program exceeded the sandbox memory limit.";
    case "output_limit": return "The program or sandbox response exceeded the output limit.";
    default: return "No further diagnostics were returned.";
  }
}
