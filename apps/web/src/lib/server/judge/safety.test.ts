import { describe, expect, it } from "vitest";
import { buildJavaProgram, validateJavaSource } from "./safety";

describe("Java submission boundary", () => {
  it("accepts a package-private Solution using qualified collection APIs", () => {
    const source = "class Solution { static int size() { return new java.util.ArrayList<Integer>().size(); } }";
    expect(validateJavaSource(source)).toBeNull();
    expect(buildJavaProgram(source, "class Main {}")).toContain("class Main");
  });

  it.each([
    ["class Solution { void x() { new java.net.Socket(); } }", "network"],
    ["class Solution { void x() { Runtime.getRuntime(); } }", "Process"],
    ["class Solution { static void main(String[] x) {} }", "Entry-point"],
    ["class Solution { String x = \\\"\\\\u0053ystem\\\"; }", "Unicode"],
    ["public class Solution {}", "must not be public"],
  ])("rejects unsupported source operations", (source, reason) => {
    expect(validateJavaSource(source)).toContain(reason);
  });

  it("requires the owned harness contract", () => {
    expect(validateJavaSource("class Answer {}")) .toContain("Solution");
  });
});
