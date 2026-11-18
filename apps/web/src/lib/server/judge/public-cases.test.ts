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

it("frames trusted println values including empty, multiline and Unicode results without rewriting submitted source", () => {
  const source = "class Solution { static String answer() { return \"hello\"; } }";
  const program = buildJavaProgram(source, framedHarness(harness));
  expect(program.startsWith(source + "\n\n")).toBe(true);
  expect(program).toContain("__leetcollabRecord(Solution.answer())");
  expect(program).toContain('System.out.println("__LEETCOLLAB_CASE_V1__"');
  expect(readCaseOutputs(frame(0, "") + frame(1, "hello\n世界"), 2)).toEqual(["", "hello\n世界"]);
});

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
