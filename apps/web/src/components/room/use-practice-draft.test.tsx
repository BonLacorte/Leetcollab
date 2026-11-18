// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Problem } from "@leetcollab/contracts";
import { usePracticeDraft } from "./use-practice-draft";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), submitted: vi.fn(), query: vi.fn(), replace: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { from: (table: string) => {
  let payload: unknown;
  const query = {
    select: (fields: string) => { mocks.query(table, "select", fields); return query; },
    eq: (field: string, value: string) => { mocks.query(table, field, value); return query; },
    order: (field: string, value: unknown) => { mocks.query(table, "order", field, value); return query; },
    limit: (value: number) => { mocks.query(table, "limit", value); return query; },
    upsert: (value: unknown) => { payload = value; return query; },
    maybeSingle: () => table === "submissions" ? mocks.submitted() : mocks.read(),
    single: () => mocks.save(payload),
  };
  return query;
} } }));
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const problem: Problem = { id: "problem-a", slug: "a", title: "A", category: "Arrays", difficulty: "Easy", sortOrder: 1,
  statement: "", starterCode: "class Solution {}", examples: [], constraints: [] };
type Input = { userId: string; roomId: string; problem: Problem; code: string; canEditCode: boolean; connected: boolean };
let latest: ReturnType<typeof usePracticeDraft>;
let change: (values: Partial<Input>) => void;
let input: Input;
let root: Root | undefined;
const row = (code: string, problemId = problem.id) => ({ user_id: "user", problem_id: problemId, draft_code: code,
  draft_language: "java", last_saved_at: "2026-11-18T03:00:00.000Z", solved_at: null, solved_code: null, solved_with: [] });
function Harness() {
  const [value, setValue] = useState(input);
  input = value;
  change = values => setValue(previous => ({ ...previous, ...values }));
  latest = usePracticeDraft({ ...value, onCodeChange: code => { mocks.replace(code); change({ code }); } });
  return <output>{value.code}</output>;
}
async function render(values: Partial<Input> = {}) {
  input = { userId: "user", roomId: "room", problem, code: problem.starterCode, canEditCode: true, connected: true, ...values };
  const container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<Harness />); });
}
async function advance(ms = 600_000) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T03:00:00.000Z"));
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ data: null, error: null });
  mocks.submitted.mockResolvedValue({ data: null, error: null });
  mocks.save.mockImplementation(async value => ({ data: row(value.draft_code, value.problem_id), error: null }));
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

it("restores a scoped saved draft and saves the latest dirty code every ten minutes without restarting on edits", async () => {
  mocks.read.mockResolvedValue({ data: row("saved Java"), error: null });
  await render();
  expect(input.code).toBe("saved Java");
  expect(mocks.query).toHaveBeenCalledWith("user_problem_progress", "user_id", "user");
  expect(mocks.query).toHaveBeenCalledWith("user_problem_progress", "problem_id", problem.id);
  await advance(300_000);
  await act(async () => change({ code: "first edit" }));
  await advance(299_999);
  await act(async () => change({ code: "latest edit" }));
  expect(mocks.save).not.toHaveBeenCalled();
  await advance(1);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user", problem_id: problem.id, draft_language: "java", draft_code: "latest edit" }));
  await advance();
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it("does not save starter code before restoration or replace edits made while loading", async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await advance();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => change({ code: "collaborator's newer code" }));
  await act(async () => finish({ data: row("older saved draft"), error: null }));
  expect(input.code).toBe("collaborator's newer code");
  expect(mocks.replace).not.toHaveBeenCalled();
  await advance();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ draft_code: "collaborator's newer code" }));
});

it("keeps existing shared code and ignores drafts from a different language", async () => {
  mocks.read.mockResolvedValue({ data: { ...row("different language"), draft_language: "python" }, error: null });
  await render({ code: "existing shared Java" });
  expect(input.code).toBe("existing shared Java");
  expect(mocks.replace).not.toHaveBeenCalled();
  await advance();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ draft_language: "java", draft_code: "existing shared Java" }));
});

it.each([{ canEditCode: false }, { connected: false }])("respects permissions and connection state: %s", async values => {
  mocks.read.mockResolvedValue({ data: row("saved Java"), error: null });
  await render(values);
  await act(async () => { latest.resetCode(); await latest.retrieveSubmission(); change({ code: "viewed code" }); });
  await advance();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.submitted).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("resets to the current starter and retrieves only this user's latest actual Java submission", async () => {
  await render({ code: "unsaved code" });
  await act(async () => latest.resetCode());
  expect(input.code).toBe(problem.starterCode);
  mocks.submitted.mockResolvedValue({ data: { source_code: "actual submitted Java", created_at: "2026-11-18T03:00:00Z" }, error: null });
  await act(async () => { await latest.retrieveSubmission(); });
  expect(input.code).toBe("actual submitted Java");
  expect(mocks.query).toHaveBeenCalledWith("submissions", "user_id", "user");
  expect(mocks.query).toHaveBeenCalledWith("submissions", "problem_id", problem.id);
  expect(mocks.query).toHaveBeenCalledWith("submissions", "language", "java");
  expect(mocks.query).toHaveBeenCalledWith("submissions", "verification", "leetcollab");
  expect(mocks.query).toHaveBeenCalledWith("submissions", "order", "created_at", { ascending: false });
  expect(mocks.query).toHaveBeenCalledWith("submissions", "limit", 1);
});

it("reports absent submissions and retrieval failures without replacing code", async () => {
  await render({ code: "unsaved code" });
  await act(async () => { await latest.retrieveSubmission(); });
  expect(latest.status).toContain("No submitted Java code");
  expect(input.code).toBe("unsaved code");
  mocks.submitted.mockRejectedValue(new Error("offline"));
  await act(async () => { await latest.retrieveSubmission(); });
  expect(latest.status).toContain("Could not retrieve");
  expect(input.code).toBe("unsaved code");
});

it("discards a retrieved submission when the shared editor changes during the read", async () => {
  let finish!: (value: unknown) => void;
  mocks.submitted.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => { void latest.retrieveSubmission(); });
  await act(async () => change({ code: "newer edit" }));
  await act(async () => finish({ data: { source_code: "older submitted code" }, error: null }));
  expect(input.code).toBe("newer edit");
  expect(latest.status).toContain("was not loaded");
});

it("flushes dirty code under the old exercise and cancels its timer when switching or unmounting", async () => {
  await render();
  await act(async () => change({ code: "exercise A edit" }));
  const second = { ...problem, id: "problem-b", starterCode: "class Solution { /* B */ }" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ problem_id: problem.id, draft_code: "exercise A edit" }));
  await act(async () => change({ code: "exercise B edit" }));
  await advance();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ problem_id: second.id, draft_code: "exercise B edit" }));
  await act(async () => root!.unmount()); root = undefined;
  await advance(1_200_000);
  expect(mocks.save).toHaveBeenCalledTimes(2);
});

it("discards old exercise reads after switching, and never overwrites a saved draft after a load failure", async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  mocks.read.mockRejectedValue(new Error("offline"));
  const second = { ...problem, id: "problem-b" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  await act(async () => finish({ data: row("old exercise draft"), error: null }));
  expect(input.code).toBe(second.starterCode);
  expect(latest.status).toContain("Could not load");
  await act(async () => change({ code: "new unsaved code" }));
  await advance();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("reports a save failure and retries dirty content at the next interval", async () => {
  await render();
  await act(async () => change({ code: "dirty code" }));
  mocks.save.mockRejectedValueOnce(new Error("offline"));
  await advance();
  expect(latest.status).toContain("Could not autosave");
  expect(input.code).toBe("dirty code");
  await advance();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(latest.status).toBe("Draft autosaved.");
});

it("waits for a navigation save before reading that exercise again", async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => change({ code: "latest A edit" }));
  const second = { ...problem, id: "problem-b" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  const readsBeforeReturn = mocks.read.mock.calls.length;
  await act(async () => change({ problem, code: problem.starterCode }));
  expect(mocks.read).toHaveBeenCalledTimes(readsBeforeReturn);
  mocks.read.mockResolvedValue({ data: row("latest A edit"), error: null });
  await act(async () => finish({ data: row("latest A edit"), error: null }));
  expect(input.code).toBe("latest A edit");
});

it("restores an intentionally empty saved draft", async () => {
  mocks.read.mockResolvedValue({ data: row(""), error: null });
  await render();
  expect(input.code).toBe("");
  expect(latest.status).toContain("Saved draft restored");
  await advance();
  expect(mocks.save).not.toHaveBeenCalled();
});
