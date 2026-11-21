import { expect, it } from "vitest";
import { compilerReport, compilerSummary, publicCompilerReport, publicExecutionDiagnostics } from "./diagnostics";

const source = "\n\n  class Solution {\n  public static int answer() {\n    return 0;\n  }\n}";
const issue = "/private/workspace/Main.java:3: error: ';' expected\n    PRIVATE_SOURCE_ECHO\n    ^";

it("maps original source lines and retains two real errors with the same location/message", () => {
  const raw = compilerReport(`${issue}\n${issue}\n2 errors\n`);
  const report = publicCompilerReport(source, null, raw.compilerDiagnostics, raw.compilerErrorCount, raw.compilerDiagnosticsComplete);
  expect(report).toEqual({
    compilerDiagnostics: [{ line: 5, message: "Expected a semicolon (;)." }, { line: 5, message: "Expected a semicolon (;)." }],
    compilerErrorCount: 2, compilerDiagnosticsComplete: true,
  });
  expect(JSON.stringify(report)).not.toContain("PRIVATE");
  expect(JSON.stringify(report)).not.toContain("workspace");
  expect(compilerSummary(report.compilerDiagnostics).split("\n")).toHaveLength(2);
});

it("reports the compiler total separately from filtered private-harness locations", () => {
  const raw = compilerReport(`${issue}\nMain.java:99: error: cannot find symbol\nPRIVATE_HARNESS\n2 errors`);
  const report = publicCompilerReport(source, null, raw.compilerDiagnostics, raw.compilerErrorCount, raw.compilerDiagnosticsComplete);
  expect(report).toMatchObject({ compilerDiagnostics: [{ line: 5 }], compilerErrorCount: 2, compilerDiagnosticsComplete: false });
  expect(report.compilerDiagnostics).toHaveLength(1);
});

it.each(["", "\n8 warnings", "\n0 errors", "\n1 errors\nadditional text"])("never invents a total without a terminal compiler summary: %s", suffix => {
  expect(compilerReport(issue + suffix)).toMatchObject({ compilerErrorCount: null, compilerDiagnosticsComplete: false });
});

it("bounds available diagnostics while retaining an explicit larger reported total", () => {
  const report = compilerReport(Array(12).fill(issue).join("\n") + "\n12 errors");
  expect(report.compilerDiagnostics).toHaveLength(8);
  expect(report).toMatchObject({ compilerErrorCount: 12, compilerDiagnosticsComplete: false });
});

it("does not claim completeness or echo arbitrary compiler message text", () => {
  const report = compilerReport("Main.java:2: error: private=HIDDEN_EXPECTED\n1 error");
  const safe = publicCompilerReport(source, null, report.compilerDiagnostics, report.compilerErrorCount, report.compilerDiagnosticsComplete);
  expect(JSON.stringify(safe)).not.toContain("HIDDEN_EXPECTED");
  expect(safe.compilerDiagnostics[0].message).toContain("Detailed compiler diagnostics are unavailable");
  expect(safe.compilerDiagnosticsComplete).toBe(false);
});

const legacySource = "\n\nclass Solution {\n  static Object answer() {\n    Stack<Character> stack = new Stack<>();\n    return stack;\n  }\n}\n";

it("maps only compiler locations in submitted source back to original editor lines", () => {
  const report = publicCompilerReport(legacySource, "/private/path/Main.java:3: error: cannot find symbol\n"
    + "    Stack<Character> stack = new Stack<>();\n    ^\n symbol: class Stack\n"
    + "Main.java:3: error: cannot find symbol\n"
    + "Main.java:11: error: incompatible types: PRIVATE_FIXTURE_LITERAL\nsecret harness source\n");
  const result = compilerSummary(report.compilerDiagnostics);
  expect(result).toBe(Array(2).fill("Line 5: Cannot find symbol. Check spelling and imports.").join("\n"));
  expect(publicExecutionDiagnostics("compile_error", legacySource, result)).toBe(result);
});

it("withholds arbitrary compiler messages, source echoes, paths, symbols and private values", () => {
  const raw = "C:\\private\\code.java:2: error: incompatible types: PRIVATE_TYPE cannot be converted to PRIVATE_VALUE\n"
    + "source echo with secrets\nMain.java:4: error: unknown PRIVATE_DIAGNOSTIC\n";
  const result = compilerSummary(publicCompilerReport(legacySource, raw).compilerDiagnostics);
  expect(result).toContain("Incompatible types. Check declarations and return values.");
  expect(result).toContain("Detailed compiler diagnostics are unavailable.");
  expect(result).not.toMatch(/PRIVATE|source echo|private|code.java/);
});

it.each(["", "error without a compiler location", "Main.java:999: error: cannot find symbol", "Main.java:0: error: cannot find symbol"])("honestly falls back when usable compiler details are absent: %s", raw => {
  expect(compilerSummary(publicCompilerReport(legacySource, raw).compilerDiagnostics)).toBe("Java compilation failed. Detailed compiler diagnostics are unavailable.");
});

it.each(["runtime_error", "time_limit", "memory_limit", "output_limit"] as const)("does not expose raw %s output containing private test data", verdict => {
  const result = publicExecutionDiagnostics(verdict, legacySource, "PRIVATE_INPUT PRIVATE_EXPECTED Main.java:3: error: cannot find symbol");
  expect(result).not.toMatch(/PRIVATE|Main.java|cannot find symbol/);
});

it("bounds displayed diagnostics while preserving actual multiplicity", () => {
  const raw = Array.from({ length: 100 }, () => "Main.java:1: error: ';' expected").join("\n");
  expect(compilerSummary(publicCompilerReport(legacySource, raw).compilerDiagnostics)).toBe(Array(8).fill("Line 3: Expected a semicolon (;).").join("\n"));
});
