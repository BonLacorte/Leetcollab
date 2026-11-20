import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { casePassed, framedHarness, publicCaseResults, readCaseOutputs, readPublicCasePlan } from "./public-cases";
import { buildJavaProgram } from "./safety";
import type { JudgeConfig } from "./types";

const harness = "class Main { public static void main(String[] args) { System.out.println(Solution.answer()); } }";
const example = { id: "sample:1", title: "Public case", input: "value = 7", expected: "42", fixtureIndex: 0 };
const plan = () => ({ format: "framed-v1", fixtureVersion: 1,
  harnessSha256: createHash("sha256").update(harness).digest("hex"), cases: [{ ...example }] });
const frame = (index: number, value: string) => `__LEETCOLLAB_CASE_V1__${index}:${Buffer.from(value).toString("base64")}\n`;

it("accepts only explicit reviewed fixture mappings with matching hash/version/expected data", () => {
  expect(readPublicCasePlan(plan(), 1, harness, ["42"])).toEqual({ format: "framed-v1", cases: [example] });
});

it.each([
  () => ({ ...plan(), fixtureVersion: 2 }),
  () => ({ ...plan(), harnessSha256: "unreviewed" }),
  () => ({ ...plan(), cases: [{ ...example, expected: "HIDDEN_EXPECTED" }] }),
  () => ({ ...plan(), cases: [{ ...example, fixtureIndex: 1 }] }),
  () => ({ ...plan(), cases: [example, example] }),
  () => ({ ...plan(), cases: [] }),
])("withholds public details for an unverified or ambiguous mapping", invalid => {
  expect(readPublicCasePlan(invalid(), 1, harness, ["42", "42"])).toBeUndefined();
});

const hasJavaCompiler = spawnSync("javac", ["-version"]).error === undefined;

it.skipIf(!hasJavaCompiler)("emits framed Java values in invocation order", () => {
  const source = `class Solution {
    static int calls;
    static String answer(String input) {
      return input + (calls++ == 0 ? "" : "\\n世界");
    }
  }`;
  const orderedHarness = `class Main {
    public static void main(String[] args) {
      System.out.println(Solution.answer(""));
      System.out.println(Solution.answer("second"));
    }
  }`;
  const dir = mkdtempSync(join(process.cwd(), ".judge-java-"));
  try {
    const file = join(dir, "Main.java");
    writeFileSync(file, buildJavaProgram(source, framedHarness(orderedHarness)));
    const compile = spawnSync("javac", ["-encoding", "UTF-8", file], { encoding: "utf8", timeout: 10_000 });
    expect(compile.status, compile.stderr).toBe(0);
    const run = spawnSync("java", ["-cp", dir, "Main"], { encoding: "utf8", timeout: 10_000 });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe(frame(0, "") + frame(1, "second\n世界"));
    expect(readCaseOutputs(run.stdout, 2)).toEqual(["", "second\n世界"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([["\uFEFF", ""], ["\uFEFF42", "42"], ["42\uFEFF ", "42"]])(
  "preserves a returned byte order mark as data",
  (actual, expected) => {
    const values = readCaseOutputs(frame(0, actual), 1);
    expect(values).toEqual([actual]);
    expect(casePassed(values![0], expected)).toBe(false);
  },
);

it.each([
  "42\n", frame(1, "42"), frame(0, "42") + frame(0, "42"),
  frame(0, "42") + "unframed output\n", "__LEETCOLLAB_CASE_V1__0:!!!\n",
  "__LEETCOLLAB_CASE_V1__0:/w==\n", "__LEETCOLLAB_CASE_V1__0:NDI\n",
])("refuses missing, reordered, duplicate or malformed framing without raw stdout fallback", output => {
  expect(readCaseOutputs(output, 1)).toBeNull();
});

it("projects only public cases and never copies hidden outputs/indexes into response data", () => {
  const config: JudgeConfig = { problemId: "problem", fixtureVersion: 1, harnessSource: harness,
    expectedOutput: ["42", "HIDDEN_EXPECTED"], fallback: null,
    publicCasePlan: { format: "framed-v1", cases: [example] } };
  expect(publicCaseResults(config, ["41", "HIDDEN_ACTUAL"])).toEqual([
    { id: example.id, title: example.title, input: example.input, expected: "42", output: "41", passed: false },
  ]);
  expect(publicCaseResults(config)).toEqual([
    { id: example.id, title: example.title, input: example.input, expected: "42", output: null, passed: null },
  ]);
  expect(JSON.stringify(publicCaseResults(config, ["42", "HIDDEN_ACTUAL"]))).not.toContain("HIDDEN");
  expect(JSON.stringify(publicCaseResults(config, ["42", "HIDDEN_ACTUAL"]))).not.toContain("fixtureIndex");
  expect(casePassed("42\nHIDDEN", "42")).toBe(false);
});
