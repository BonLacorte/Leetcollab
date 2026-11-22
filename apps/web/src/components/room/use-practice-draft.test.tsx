// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Problem } from "@leetcollab/contracts";
import { usePracticeDraft } from "./use-practice-draft";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), submitted: vi.fn(), acknowledge: vi.fn(), query: vi.fn(), replace: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: (name: string, payload: unknown) => {
  if (name !== "save_practice_draft") throw new Error(`Unexpected RPC ${name}`);
  return mocks.save(payload);
}, from: (table: string) => {
  const query = {
    select: (fields: string) => { mocks.query(table, "select", fields); return query; },
    eq: (field: string, value: string) => { mocks.query(table, field, value); return query; },
    order: (field: string, value: unknown) => { mocks.query(table, "order", field, value); return query; },
    limit: (value: number) => { mocks.query(table, "limit", value); return query; },
    maybeSingle: () => table === "submissions" ? mocks.submitted() : mocks.read(),
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
const row = (code: string) => ({ draft_code: code, draft_language: "java",
  last_saved_at: "2026-11-18T03:00:00.000Z", solved_at: null, solved_with: [] });
const savedVersion = ({ last_saved_at, solved_at, solved_with }: ReturnType<typeof row>) =>
  ({ last_saved_at, solved_at, solved_with });
function Harness() {
  const [value, setValue] = useState(input);
  input = value;
  change = values => setValue(previous => ({ ...previous, ...values }));
  latest = usePracticeDraft({ ...value, onCodeChange: code => { mocks.replace(code); change({ code }); },
    onCodeReplace: async (problemId, expectedCode, code) => {
      await mocks.acknowledge(problemId, expectedCode, code);
      mocks.replace(code);
      change({ code });
    },
  });
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
  mocks.acknowledge.mockResolvedValue(undefined);
  mocks.save.mockReset().mockResolvedValue({ data: savedVersion(row("")), error: null });
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers(); });

it("keeps a scoped draft private and saves the latest dirty code every ten minutes without restarting on edits", async () => {
  mocks.read.mockResolvedValue({ data: row("saved Java"), error: null });
  await render();
  expect(input.code).toBe(problem.starterCode);
  expect(latest.progress?.lastSavedAt).toBe("2026-11-18T03:00:00.000Z");
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledWith("user_problem_progress", "user_id", "user");
  expect(mocks.query).toHaveBeenCalledWith("user_problem_progress", "problem_id", problem.id);
  await advance(300_000);
  await act(async () => latest.editCode("first edit"));
  await advance(299_999);
  await act(async () => latest.editCode("latest edit"));
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => change({ code: "remote code after my edit" }));
  await advance(1);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ p_user_id: "user", p_problem_id: problem.id, p_draft_code: "latest edit", p_expected_saved_at: row("").last_saved_at }));
  await advance();
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it("does not save starter code before reading the draft or replace edits made while loading", async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mocks.read.mockResolvedValue({ data: row("older saved draft"), error: null });
  await render();
  await advance();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => change({ code: "collaborator's newer code" }));
  await act(async () => finish({ data: row("older saved draft"), error: null }));
  expect(input.code).toBe("collaborator's newer code");
  expect(mocks.replace).not.toHaveBeenCalled();
  await advance();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => latest.restoreDraft());
  expect(input.code).toBe("older saved draft");
  expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("older saved draft");
});

it("keeps existing shared code and ignores drafts from a different language", async () => {
  mocks.read.mockResolvedValue({ data: { ...row("different language"), draft_language: "python" }, error: null });
  await render({ code: "existing shared Java" });
  expect(input.code).toBe("existing shared Java");
  expect(mocks.replace).not.toHaveBeenCalled();
  await advance();
  await act(async () => latest.restoreDraft());
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it.each([{ canEditCode: false }, { connected: false }])("respects permissions and connection state: %s", async values => {
  mocks.read.mockResolvedValue({ data: row("saved Java"), error: null });
  await render(values);
  await act(async () => { latest.resetCode(); latest.restoreDraft(); await latest.retrieveSubmission(); change({ code: "viewed code" }); });
  await advance();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.submitted).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it.each(["timer", "navigation"])("saves the last authorized edit after permission is revoked via %s", async trigger => {
  mocks.read.mockResolvedValue({ data: row("previous private draft"), error: null });
  await render();
  await act(async () => latest.editCode("authorized edit"));
  await act(async () => change({ canEditCode: false, code: "collaborator edit" }));
  await act(async () => {
    latest.editCode("unauthorized edit");
    latest.restoreDraft();
    latest.resetCode();
    await latest.retrieveSubmission();
  });
  expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("authorized edit");
  expect(mocks.submitted).not.toHaveBeenCalled();
  if (trigger === "timer") await advance();
  else { await act(async () => root!.unmount()); root = undefined; }
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ p_draft_code: "authorized edit" }));
});

it("resets to the current starter and retrieves only this user's latest actual Java submission", async () => {
  await render({ code: "unsaved code" });
  await act(async () => latest.resetCode());
  expect(input.code).toBe(problem.starterCode);
  mocks.submitted.mockResolvedValue({ data: { source_code: "actual submitted Java" }, error: null });
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
  expect(latest.status).toContain("Could not confirm");
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

it.each(["restoreDraft", "resetCode", "retrieveSubmission"] as const)("keeps the editor intact until realtime accepts %s", async action => {
  mocks.read.mockResolvedValue({ data: row("previous private draft"), error: null });
  mocks.submitted.mockResolvedValue({ data: { source_code: "last submitted code" }, error: null });
  let reject!: (error: Error) => void;
  mocks.acknowledge.mockImplementationOnce(() => new Promise((_resolve, refuse) => { reject = refuse; }));
  await render({ code: "visible shared code" });
  await act(async () => { void latest[action](); });
  const replacement = { restoreDraft: "previous private draft", resetCode: problem.starterCode, retrieveSubmission: "last submitted code" }[action];
  expect(mocks.acknowledge).toHaveBeenCalledExactlyOnceWith(problem.id, "visible shared code", replacement);
  expect(latest.status).toContain("Preparing");
  expect(mocks.replace).not.toHaveBeenCalled();
  await act(async () => latest.editCode("keystroke during replacement"));
  expect(input.code).toBe("visible shared code");
  await act(async () => reject(new Error("The shared exercise or code changed.")));
  expect(latest.status).toContain("Could not confirm");
  expect(input.code).toBe("visible shared code");
});

it.each([false, true])("flushes captured edits after a pending read only if it succeeds (failure=%s)", async failure => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render({ userId: `pending-read-${failure}` });
  await act(async () => latest.editCode("captured during read"));
  const second = { ...problem, id: "problem-b" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  const readsBeforeReturn = mocks.read.mock.calls.length;
  await act(async () => change({ problem, code: problem.starterCode }));
  expect(mocks.read).toHaveBeenCalledTimes(readsBeforeReturn);
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => finish(failure ? { error: new Error("offline") } : { data: row("previous draft"), error: null }));
  if (failure) {
    expect(mocks.save).not.toHaveBeenCalled();
    expect(latest.conflictingDraft).toBe("captured during read");
  }
  else expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ p_problem_id: problem.id, p_draft_code: "captured during read" }));
  expect(input.code).toBe(problem.starterCode);
});

it("flushes dirty code under the old exercise and cancels its timer when switching or unmounting", async () => {
  await render();
  await act(async () => latest.editCode("exercise A edit"));
  const second = { ...problem, id: "problem-b", starterCode: "class Solution { /* B */ }" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ p_problem_id: problem.id, p_draft_code: "exercise A edit" }));
  await act(async () => latest.editCode("exercise B edit"));
  await advance();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ p_problem_id: second.id, p_draft_code: "exercise B edit" }));
  await act(async () => root!.unmount()); root = undefined;
  await advance(1_200_000);
  expect(mocks.save).toHaveBeenCalledTimes(2);
});

it("discards old exercise reads after switching, and never overwrites a saved draft after a load failure", async () => {
  let finish!: (value: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render({ userId: "failed-read" });
  mocks.read.mockRejectedValue(new Error("offline"));
  const second = { ...problem, id: "problem-b" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  await act(async () => finish({ data: row("old exercise draft"), error: null }));
  expect(input.code).toBe(second.starterCode);
  expect(latest.status).toContain("Could not load");
  await act(async () => latest.editCode("new unsaved code"));
  await advance();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => change({ problem, code: problem.starterCode }));
  mocks.read.mockResolvedValue({ data: row("saved elsewhere"), error: null });
  await act(async () => change({ problem: second, code: second.starterCode }));
  expect(latest.conflictingDraft).toBe("new unsaved code");
  expect(latest.progress?.lastSavedAt).toBe("2026-11-18T03:00:00.000Z");
});

it.each(["timer", "navigation"])("retains a recovered conflict for the next %s save", async trigger => {
  const oldDraft = row("previous draft");
  mocks.read.mockResolvedValue({ data: oldDraft, error: null });
  mocks.save.mockResolvedValueOnce({ data: null, error: null });
  await render({ userId: `conflict-${trigger}` });
  await act(async () => latest.editCode("my unsaved edit"));
  await advance();
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
    p_user_id: `conflict-${trigger}`, p_problem_id: problem.id, p_draft_code: "my unsaved edit",
    p_expected_saved_at: oldDraft.last_saved_at,
  });
  expect(latest.status).toContain("This edit was not saved");
  expect(input.code).toBe("my unsaved edit");
  expect(latest.progress?.lastSavedAt).toBe("2026-11-18T03:00:00.000Z");
  mocks.read.mockResolvedValue({ data: { ...row("newer tab draft"), last_saved_at: "2026-11-18T03:01:00.000Z" }, error: null });
  await act(async () => latest.restoreDraft());
  expect(input.code).toBe("my unsaved edit");
  expect(latest.conflictingDraft).toBe("my unsaved edit");
  mocks.acknowledge.mockRejectedValueOnce(new Error("replacement rejected"));
  await act(async () => latest.recoverConflict());
  expect(latest.conflictingDraft).toBe("my unsaved edit");
  await act(async () => latest.recoverConflict());
  expect(latest.conflictingDraft).toBeNull();
  expect(latest.progress?.lastSavedAt).toBe("2026-11-18T03:01:00.000Z");
  mocks.save.mockResolvedValueOnce({ data: savedVersion(row("my unsaved edit")), error: null });
  if (trigger === "timer") await advance();
  else {
    const second = { ...problem, id: "problem-b" };
    await act(async () => change({ problem: second, code: second.starterCode }));
  }
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
    p_draft_code: "my unsaved edit", p_expected_saved_at: "2026-11-18T03:01:00.000Z",
  }));
});

it("preserves a navigation save conflict privately when revisiting the exercise", async () => {
  mocks.read.mockResolvedValue({ data: row("old draft"), error: null });
  await render({ userId: "navigation-conflict-user" });
  await act(async () => latest.editCode("unsaved first-tab edit"));
  mocks.read.mockResolvedValue({ data: { ...row("newer tab draft"), last_saved_at: "2026-11-18T03:01:00.000Z" }, error: null });
  mocks.save.mockResolvedValueOnce({ data: null, error: null });
  const second = { ...problem, id: "problem-b" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  expect(latest.conflictingDraft).toBeNull();
  await act(async () => change({ problem, code: problem.starterCode }));
  expect(latest.progress?.lastSavedAt).toBe("2026-11-18T03:01:00.000Z");
  expect(latest.conflictingDraft).toBe("unsaved first-tab edit");
  expect(input.code).toBe(problem.starterCode);
  await act(async () => {
    latest.editCode("second unsaved edit");
    await latest.resetCode();
    await latest.retrieveSubmission();
  });
  expect(latest.conflictingDraft).toBe("unsaved first-tab edit");
  expect(input.code).toBe(problem.starterCode);
  expect(mocks.acknowledge).not.toHaveBeenCalled();
  await advance();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await act(async () => latest.discardConflict());
  expect(latest.conflictingDraft).toBeNull();
  expect(input.code).toBe(problem.starterCode);
  mocks.read.mockResolvedValue({ data: { ...row("latest saved draft"), last_saved_at: "2026-11-18T03:02:00.000Z" }, error: null });
  await act(async () => latest.restoreDraft());
  expect(input.code).toBe("latest saved draft");
});

it.each(["timer", "navigation", "restore"])("preserves an edit matching the stale cached draft on %s", async trigger => {
  const cached = row("cached draft");
  mocks.read.mockResolvedValue({ data: cached, error: null });
  await render({ userId: `cached-draft-${trigger}` });
  mocks.read.mockResolvedValue({ data: { ...row("newer tab draft"), last_saved_at: "2026-11-18T03:01:00.000Z" }, error: null });
  await act(async () => latest.editCode("cached draft"));

  if (trigger === "restore") {
    await act(async () => latest.restoreDraft());
    expect(input.code).toBe("newer tab draft");
    expect(mocks.save).not.toHaveBeenCalled();
  } else {
    mocks.save.mockResolvedValueOnce({ data: null, error: null });
    if (trigger === "navigation") {
      await act(async () => change({ problem: { ...problem, id: "problem-b" }, code: problem.starterCode }));
      await act(async () => change({ problem, code: problem.starterCode }));
    } else {
      await advance();
    }
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      p_draft_code: "cached draft", p_expected_saved_at: cached.last_saved_at,
    }));
  }
  expect(latest.conflictingDraft).toBe("cached draft");
});

it("only clears the edit sent by a save when the same text is entered again mid-save", async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => latest.editCode("first edit"));
  await advance();
  await act(async () => latest.editCode("different edit"));
  await act(async () => latest.editCode("first edit"));
  const saved = savedVersion({ ...row("first edit"), last_saved_at: "2026-11-18T03:10:00.000Z" });
  await act(async () => finish({ data: saved, error: null }));
  await advance();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
    p_draft_code: "first edit", p_expected_saved_at: saved.last_saved_at,
  }));
});

it("reports a save failure and retries dirty content at the next interval", async () => {
  await render();
  await act(async () => latest.editCode("dirty code"));
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
  const original = row("previous draft");
  const departure = { ...row("latest A edit"), last_saved_at: "2026-11-18T03:01:00.000Z" };
  mocks.read.mockResolvedValue({ data: original, error: null });
  await render();
  await act(async () => latest.editCode("latest A edit"));
  const second = { ...problem, id: "problem-b" };
  await act(async () => change({ problem: second, code: second.starterCode }));
  const readsBeforeReturn = mocks.read.mock.calls.length;
  await act(async () => change({ problem, code: problem.starterCode }));
  expect(mocks.read).toHaveBeenCalledTimes(readsBeforeReturn);
  mocks.read.mockResolvedValue({ data: departure, error: null });
  await act(async () => finish({ data: savedVersion(departure), error: null }));
  expect(input.code).toBe(problem.starterCode);
  expect(latest.progress?.lastSavedAt).toBe(departure.last_saved_at);
  await act(async () => latest.restoreDraft());
  expect(input.code).toBe("latest A edit");
});

it("waits for earlier saves before enabling edits on a revisit", async () => {
  const pending: Array<() => void> = [];
  let stored = row("previous draft");
  mocks.read.mockImplementation(async () => ({ data: stored, error: null }));
  mocks.save.mockImplementation(value => new Promise(resolve => pending.push(() => {
    stored = { ...row(value.p_draft_code), last_saved_at: new Date(Date.parse(stored.last_saved_at) + 60_000).toISOString() };
    resolve({ data: savedVersion(stored), error: null });
  })));
  await render();
  await act(async () => latest.editCode("first autosave"));
  await advance();
  const second = { ...problem, id: "problem-b" };
  await act(async () => latest.editCode("first visit departure"));
  await act(async () => change({ problem: second, code: second.starterCode }));
  await act(async () => change({ problem, code: problem.starterCode }));
  await act(async () => latest.editCode("premature edit"));
  expect(latest.waitingForDraftWrite).toBe(true);
  expect(input.code).toBe(problem.starterCode);
  await act(async () => pending[0]());
  expect(pending).toHaveLength(2);
  expect(latest.waitingForDraftWrite).toBe(true);
  expect(mocks.save).toHaveBeenNthCalledWith(2, expect.objectContaining({
    p_draft_code: "first visit departure", p_expected_saved_at: "2026-11-18T03:01:00.000Z",
  }));
  await act(async () => pending[1]());
  expect(latest.waitingForDraftWrite).toBe(false);
  expect(latest.progress?.lastSavedAt).toBe("2026-11-18T03:02:00.000Z");
  await act(async () => latest.editCode("edit after previous save"));
  expect(input.code).toBe("edit after previous save");
  await advance();
  expect(mocks.save).toHaveBeenNthCalledWith(3, expect.objectContaining({
    p_draft_code: "edit after previous save", p_expected_saved_at: "2026-11-18T03:02:00.000Z",
  }));
  await act(async () => pending[2]());
});

it("keeps an intentionally empty saved draft private", async () => {
  mocks.read.mockResolvedValue({ data: row(""), error: null });
  await render();
  expect(input.code).toBe(problem.starterCode);
  expect(latest.progress?.lastSavedAt).toBe("2026-11-18T03:00:00.000Z");
  expect(mocks.replace).not.toHaveBeenCalled();
  await act(async () => latest.restoreDraft());
  expect(input.code).toBe("");
  await advance();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("restores the first Java draft saved in another tab after this room loaded", async () => {
  await render();
  expect(latest.progress).toBeNull();
  mocks.read.mockResolvedValue({ data: row("saved in another tab"), error: null });
  await act(async () => latest.restoreDraft());
  expect(input.code).toBe("saved in another tab");
});

it("resumes autosave after Restore finds no draft following an initial read failure", async () => {
  mocks.read.mockResolvedValueOnce({ data: null, error: new Error("Offline") });
  await render({ userId: "fresh-empty-draft" });
  expect(latest.status).toContain("Autosave is paused");
  await act(async () => latest.editCode("private text typed offline"));
  await act(async () => latest.restoreDraft());
  expect(latest.status).toContain("No saved Java draft");
  expect(input.code).toBe("private text typed offline");
  expect(mocks.acknowledge).not.toHaveBeenCalled();
  await advance();
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    p_draft_code: "private text typed offline", p_expected_saved_at: null,
  }));
});
