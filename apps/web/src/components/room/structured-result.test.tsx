// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { PracticeResult, type PracticeExecution } from "./practice-result";
import type { StructuredSubmission } from "./execution-feedback";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const source = "class Solution {\n  static int answer() {\n    return 12\n  }\n}";
const submission: StructuredSubmission = {
  id: "22222222-2222-4222-8222-222222222222", problemId: "11111111-1111-4111-8111-111111111111", language: "java",
  verdict: "compile_error", verification: "leetcollab", testsPassed: 0, testsTotal: 4, durationMs: 10,
  diagnostics: "Generic legacy compiler summary", createdAt: "2026-11-18T03:00:00.000Z",
  compilerDiagnostics: [{ line: 3, column: 14, message: "Expected a semicolon (;)." }, { line: 3, message: "Not a valid Java statement." }],
  compilerErrorCount: 2, compilerDiagnosticsComplete: true,
};
let root: Root;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); });
async function render(overrides: Partial<StructuredSubmission> = {}, sourceCode = source) {
  const execution: PracticeExecution = { action: "Run", sourceCode, codeVersion: 1, state: "finished", response: {
    ok: true, quota: { used: 1, limit: 50, remaining: 49, active: 0, resetAt: "2026-11-18T23:55:00.000Z" }, submission: { ...submission, ...overrides },
  } };
  container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<PracticeResult execution={execution} />); });
}

it("shows each diagnostic with the matching submitted source and a confirmed total", async () => {
  await render();
  expect(container.querySelector("h2")?.textContent).toBe("Compile Error");
  expect(container.querySelector(".compiler-error-count")?.textContent).toBe("2 compiler errors");
  expect(container.querySelector(".compiler-feedback")?.lastElementChild?.className).toBe("compiler-error-count");
  const excerpts = container.querySelectorAll(".compiler-source");
  expect(excerpts).toHaveLength(2);
  expect(Array.from(excerpts, node => node.textContent)).toEqual(["    return 12", "    return 12"]);
  expect(container.querySelector(".compiler-source mark")).not.toBeNull();
  expect(container.textContent).not.toContain("Generic legacy compiler summary");
});

it("keeps diagnostic multiplicity and labels incomplete counts honestly", async () => {
  await render({ compilerErrorCount: 4, compilerDiagnosticsComplete: false,
    compilerDiagnostics: [submission.compilerDiagnostics![0], submission.compilerDiagnostics![0]] });
  expect(container.querySelectorAll(".compiler-diagnostics li")).toHaveLength(2);
  expect(container.querySelector(".compiler-error-count")?.textContent).toBe("4 compiler errors · 2 source diagnostics available");
});

it("does not invent a compiler total or display out-of-source locations", async () => {
  await render({ compilerErrorCount: null, compilerDiagnosticsComplete: false,
    compilerDiagnostics: [...submission.compilerDiagnostics!, { line: 900, message: "PRIVATE_HARNESS_ECHO" }] });
  expect(container.querySelector(".compiler-error-count")?.textContent).toBe("2 source diagnostics available · Compiler total not provided");
  expect(container.textContent).not.toContain("PRIVATE_HARNESS_ECHO");
});

it("renders submitted source as text, including HTML-looking characters", async () => {
  await render({ compilerDiagnostics: [{ line: 2, message: "Expected a semicolon (;)." }], compilerErrorCount: 1 }, "class Solution {\n<script>privateText()</script>\n}");
  expect(container.querySelector(".compiler-source")?.textContent).toBe("<script>privateText()</script>");
  expect(container.querySelector("script")).toBeNull();
});

it("preserves an honest fallback for legacy responses without structured locations", async () => {
  await render({ compilerDiagnostics: undefined, compilerErrorCount: undefined, compilerDiagnosticsComplete: undefined });
  expect(container.textContent).toContain("Generic legacy compiler summary");
  expect(container.textContent).toContain("Detailed error locations and compiler total are unavailable.");
  expect(container.querySelectorAll(".compiler-source")).toHaveLength(0);
});

it("shows actual public-case Input, Output and Expected with passed and failed tabs", async () => {
  await render({ verdict: "wrong_answer", testsPassed: 1, testsTotal: 3, diagnostics: "1 of 3 checks passed.", publicCases: [
    { id: "public-a", title: "First public example", input: "signal = ()", output: "false", expected: "true", passed: false },
    { id: "public-b", title: "Second public example", input: "signal = [(])", output: "false", expected: "false", passed: true },
  ] });
  expect(container.querySelector("h2")?.textContent).toBe("Wrong Answer");
  expect(container.querySelector(".execution-summary")?.textContent).toContain("1 of 3 checks passed · 2 failed");
  const panel = () => container.querySelector('.public-case-detail[data-state="active"]')!;
  expect(Array.from(panel().querySelectorAll("dt"), node => node.textContent)).toEqual(["Input", "Output", "Expected"]);
  expect(Array.from(panel().querySelectorAll("pre"), node => node.textContent)).toEqual(["signal = ()", "false", "true"]);
  expect(panel().textContent).toContain("Failed");
  const second = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(tab => tab.textContent?.startsWith("Case 2"))!;
  await act(async () => { second.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); second.click(); });
  expect(panel().textContent).toContain("Second public example");
  expect(panel().textContent).toContain("Passed");
  expect(Array.from(panel().querySelectorAll("pre"), node => node.textContent)).toEqual(["signal = [(])", "false", "false"]);
});

it("does not invent output or a public-case pass from an Accepted aggregate verdict", async () => {
  await render({ verdict: "accepted", testsPassed: 4, diagnostics: "All checks passed.", publicCases: [
    { id: "public-a", title: "Public example", input: "public input", output: null, expected: "expected-only", passed: null },
  ] });
  expect(container.querySelector("h2")?.textContent).toBe("Accepted");
  const panel = container.querySelector('.public-case-detail[data-state="active"]')!;
  expect(panel.textContent).toContain("Result unavailable");
  expect(Array.from(panel.querySelectorAll("pre"), node => node.textContent)).toEqual(["public input", "Not available", "expected-only"]);
});

it("keeps the aggregate Accepted result when public attribution is unavailable", async () => {
  await render({ verdict: "accepted", testsPassed: 4, diagnostics: "All checks passed.", publicCases: undefined });
  expect(container.querySelector("h2")?.textContent).toBe("Accepted");
  expect(container.textContent).toContain("Public testcase details are not available for this submission.");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
});

it("preserves an observed empty public output as data rather than unavailable", async () => {
  await render({ verdict: "accepted", testsPassed: 4, publicCases: [
    { id: "compact-empty", title: "Empty public example", input: "text = empty", output: "", expected: "", passed: true },
  ] });
  const panel = container.querySelector('.public-case-detail[data-state="active"]')!;
  expect(panel.textContent).toContain("Passed");
  expect(Array.from(panel.querySelectorAll("pre"), node => node.textContent)).toEqual(["text = empty", "(empty output)", "(empty output)"]);
  expect(panel.textContent).not.toContain("Not available");
});
