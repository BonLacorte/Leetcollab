// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EditorPanel } from "./editor-panel";

vi.mock("../theme-provider", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("../practice-controls", () => ({ PracticeControls: () => <div>Judge controls</div> }));
vi.mock("@uiw/react-codemirror", () => ({ default: ({ value }: { value: string }) => <textarea readOnly value={value} /> }));
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); });

it("preserves draft actions without presenting legacy manual completion as solved", async () => {
  const save = vi.fn();
  const load = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<EditorPanel problemId="problem" code="class Solution {}" canEditCode progress={{
      userId: "user", problemId: "problem", draftCode: "saved code", draftLanguage: "java",
      lastSavedAt: "2026-11-13T12:00:00.000Z", solvedAt: "2026-11-13T12:00:00.000Z",
      solvedCode: "unverified code", solvedWith: [{ userId: "user", username: "old member" }],
    }} progressStatus="" isProgressLoading={false} onCodeChange={() => {}} onSaveDraft={save} onLoadDraft={load} />);
  });
  expect(container.textContent).not.toContain("Mark solved");
  expect(container.querySelector(".editor-progress")?.textContent).not.toContain("Solved");
  expect(container.querySelector(".editor-progress")?.textContent).toContain("Draft saved");
  expect(container.textContent).toContain("Prior manual completion (unverified)");
  expect(container.textContent).toContain("old member");
  const buttons = Array.from(container.querySelectorAll("button"));
  await act(async () => { buttons.find(b => b.textContent === "Save draft")!.click(); buttons.find(b => b.textContent === "Load draft")!.click(); });
  expect(save).toHaveBeenCalledOnce();
  expect(load).toHaveBeenCalledOnce();
});
