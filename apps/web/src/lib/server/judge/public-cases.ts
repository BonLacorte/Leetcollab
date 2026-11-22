import { createHash } from "node:crypto";
import { judgePublicCaseSchema, type JudgePublicCase } from "@leetcollab/contracts";
import type { JudgeConfig } from "./types";

const publicExampleSchema = judgePublicCaseSchema.omit({ output: true, passed: true });
const prefix = "__LEETCOLLAB_CASE_V1__";

/** Metadata is private, explicitly curated, and bound to the exact fixture. */
export function readPublicCasePlan(
  value: unknown, fixtureVersion: number, harness: string, expected: string[],
): JudgeConfig["publicCasePlan"] {
  if (!value || typeof value !== "object") return;
  const plan = value as Record<string, unknown>;
  if (plan.format !== "framed-v1" || plan.fixtureVersion !== fixtureVersion
    || plan.harnessSha256 !== createHash("sha256").update(harness).digest("hex")
    || !Array.isArray(plan.cases) || plan.cases.length < 1 || plan.cases.length > 16) return;
  const cases: NonNullable<JudgeConfig["publicCasePlan"]>["cases"] = [];
  for (const item of plan.cases) {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const example = publicExampleSchema.safeParse(record);
    const index = record.fixtureIndex;
    if (!example.success || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0
      || index >= expected.length || expected[index] !== example.data.expected) return;
    cases.push({ ...example.data, fixtureIndex: index });
  }
  if (new Set(cases.map(item => item.id)).size !== cases.length
    || new Set(cases.map(item => item.fixtureIndex)).size !== cases.length) return;
  // Public invocations precede private invocations, preventing private inputs
  // from reaching public output through state left by an earlier hidden case.
  if (cases.some(item => item.fixtureIndex >= cases.length)) return;
  return { cases };
}

/** Change trusted harness output only. Submitted source is never rewritten. */
export function framedHarness(harness: string): string {
  if (!/^class Main\s*\{/.test(harness) || !harness.includes("System.out.println(")) {
    throw new Error("Unsupported public-case harness.");
  }
  const body = harness.replaceAll("System.out.println(", "__leetcollabRecord(");
  return body.replace(/^class Main\s*\{/, `class Main {
  private static int __leetcollabCase = 0;
  private static void __leetcollabRecord(Object value) {
    String encoded = java.util.Base64.getEncoder().encodeToString(
      String.valueOf(value).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    System.out.println("${prefix}" + (__leetcollabCase++) + ":" + encoded);
  }`);
}

/** Never fall back to positional raw stdout when the framed protocol is absent. */
export function readCaseOutputs(output: string, count: number): string[] | null {
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== count) return null;
  const values: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^__LEETCOLLAB_CASE_V1__(0|[1-9]\d*):([A-Za-z0-9+/]*={0,2})$/.exec(lines[index]);
    if (!match || Number(match[1]) !== index) return null;
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.toString("base64") !== match[2]) return null;
    try { values.push(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); }
    catch { return null; }
  }
  return values;
}

export function casePassed(actual: string, expected: string): boolean {
  return !/[\r\n]/.test(actual) && actual.replace(/[^\S\uFEFF]+$/u, "") === expected;
}

export function publicCaseResults(config: JudgeConfig, outputs: string[]): JudgePublicCase[] | undefined {
  return config.publicCasePlan?.cases.map(({ fixtureIndex, ...example }) => {
    const actual = outputs[fixtureIndex];
    return {
      ...example,
      output: actual.length <= 4096 ? actual : null,
      passed: casePassed(actual, config.expectedOutput[fixtureIndex]),
    };
  });
}
