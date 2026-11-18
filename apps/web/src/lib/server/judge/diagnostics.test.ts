import { expect, it } from "vitest";
import { compilerDiagnostics, publicExecutionDiagnostics } from "./diagnostics";

const source = "\n\nclass Solution {\n  static Object answer() {\n    Stack<Character> stack = new Stack<>();\n    return stack;\n  }\n}\n";

it("maps only compiler locations in submitted source back to original editor lines", () => {
  const issues = compilerDiagnostics("/private/path/Main.java:3: error: cannot find symbol\n"
    + "    Stack<Character> stack = new Stack<>();\n    ^\n symbol: class Stack\n"
    + "Main.java:3: error: cannot find symbol\n"
    + "Main.java:11: error: incompatible types: PRIVATE_FIXTURE_LITERAL\nsecret harness source\n");
  const result = publicExecutionDiagnostics("compile_error", source, null, issues);
  expect(result).toBe("Line 5: Cannot find symbol. Check spelling and imports.");
  expect(publicExecutionDiagnostics("compile_error", source, result, [])).toBe(result);
});

it("withholds arbitrary compiler messages, source echoes, paths, symbols and private values", () => {
  const raw = "C:\\private\\code.java:2: error: incompatible types: PRIVATE_TYPE cannot be converted to PRIVATE_VALUE\n"
    + "source echo with secrets\nMain.java:4: error: unknown PRIVATE_DIAGNOSTIC\n";
  const result = publicExecutionDiagnostics("compile_error", source, raw);
  expect(result).toContain("Incompatible types. Check declarations and return values.");
  expect(result).toContain("Detailed compiler diagnostics are unavailable.");
  expect(result).not.toMatch(/PRIVATE|source echo|private|code.java/);
});

it.each(["", "error without a compiler location", "Main.java:999: error: cannot find symbol", "Main.java:0: error: cannot find symbol"])("honestly falls back when usable compiler details are absent: %s", raw => {
  expect(publicExecutionDiagnostics("compile_error", source, raw)).toBe("Java compilation failed. Detailed compiler diagnostics are unavailable.");
});

it.each(["runtime_error", "time_limit", "memory_limit", "output_limit"] as const)("does not expose raw %s output containing private test data", verdict => {
  const result = publicExecutionDiagnostics(verdict, source, "PRIVATE_INPUT PRIVATE_EXPECTED Main.java:3: error: cannot find symbol");
  expect(result).not.toMatch(/PRIVATE|Main.java|cannot find symbol/);
});

it("bounds and deduplicates displayed diagnostics", () => {
  const raw = Array.from({ length: 100 }, () => "Main.java:1: error: ';' expected").join("\n");
  expect(compilerDiagnostics(raw)).toHaveLength(8);
  expect(publicExecutionDiagnostics("compile_error", source, raw)).toBe("Line 3: Expected a semicolon (;).");
});
