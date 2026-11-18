// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EditorPanel } from "./editor-panel";

vi.mock("../theme-provider", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("../practice-controls", () => ({ PracticeControls: () => <div>Judge controls</div> }));
vi.mock("@uiw/react-codemirror", async importOriginal => ({ ...await importOriginal<typeof import("@uiw/react-codemirror")>(), default: ({ value }: { value: string }) => <textarea readOnly value={value} /> }));
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); });

it("uses accessible icon-only reset and retrieval actions without presenting manual completion as solved", async () => {
  const reset = vi.fn();
  const retrieve = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<EditorPanel problemId="problem" code="class Solution {}" codeVersion={0} execution={null} canEditCode progress={{
      userId: "user", problemId: "problem", draftCode: "saved code", draftLanguage: "java",
      lastSavedAt: "2026-11-13T12:00:00.000Z", solvedAt: "2026-11-13T12:00:00.000Z",
      solvedCode: "unverified code", solvedWith: [{ userId: "user", username: "old member" }],
    }} progressStatus="Autosaves every 10 minutes when code changes." isProgressLoading={false} isRetrievingSubmission={false} connected onCodeChange={() => {}} onResetCode={reset} onRetrieveSubmission={retrieve} onExecutionChange={() => {}} />);
  });
  expect(container.textContent).not.toContain("Mark solved");
  expect(container.querySelector(".editor-progress")?.textContent).not.toContain("Solved");
  expect(container.querySelector(".editor-progress")?.textContent).toContain("Draft autosaved");
  expect(container.textContent).toContain("Prior manual completion (unverified)");
  expect(container.textContent).toContain("old member");
  expect(container.textContent).not.toContain("Save draft");
  expect(container.textContent).not.toContain("Load draft");
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".editor-actions button"));
  expect(buttons.map(b => b.textContent)).toEqual(["", ""]);
  expect(buttons.map(b => b.getAttribute("aria-label"))).toEqual(["Reset to default code definition", "Retrieve last submitted code"]);
  for (const button of buttons) expect(container.querySelector(`[id="${button.getAttribute("aria-describedby")}"]`)?.getAttribute("role")).toBe("tooltip");
  await act(async () => { buttons[0].click(); buttons[1].click(); });
  expect(reset).toHaveBeenCalledOnce();
  expect(retrieve).toHaveBeenCalledOnce();
});
