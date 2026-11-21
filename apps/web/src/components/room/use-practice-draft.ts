import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Problem, ProblemProgress, SolvedWithMember } from "@leetcollab/contracts";
import { supabase } from "../../lib/supabase";

type ProgressRow = {
  user_id: string; problem_id: string; draft_code: string | null; draft_language: string | null;
  last_saved_at: string | null; solved_at: string | null; solved_with: SolvedWithMember[] | null; solved_code: string | null;
};
const progressSelect = "user_id, problem_id, draft_code, draft_language, last_saved_at, solved_at, solved_with, solved_code";
const autosaveMs = 10 * 60 * 1000;
// A route or exercise can remount before its final save finishes. Serialize
// writes and wait for them before restoring that same user's exercise again.
const pendingDraftWrites = new Map<string, Promise<void>>();
const conflictingDrafts = new Map<string, string>();

function progressFromRow(row: ProgressRow): ProblemProgress {
  return { userId: row.user_id, problemId: row.problem_id, draftCode: row.draft_code ?? "",
    draftLanguage: row.draft_language ?? "java", lastSavedAt: row.last_saved_at, solvedAt: row.solved_at,
    solvedWith: Array.isArray(row.solved_with) ? row.solved_with : [], solvedCode: row.solved_code };
}

async function readProgress(userId: string, problemId: string): Promise<ProgressRow | null> {
  const { data, error } = await supabase.from("user_problem_progress").select(progressSelect)
    .eq("user_id", userId).eq("problem_id", problemId).maybeSingle();
  if (error) throw error;
  return data as ProgressRow | null;
}

function javaDraft(row: ProgressRow | null): string | null {
  return row?.last_saved_at && row.draft_language === "java" ? row.draft_code : null;
}

type Options = {
  roomId: string; userId?: string; problem: Problem | null; code: string;
  canEditCode: boolean; connected: boolean; onCodeChange: (code: string) => void;
  onCodeReplace: (problemId: string, expectedCode: string, code: string) => Promise<void>;
};

export function usePracticeDraft(options: Options) {
  const { roomId, userId, problem, code } = options;
  const problemId = problem?.id;
  const scope = `${roomId}:${userId}:${problemId}:java`;
  const persistenceScope = `${userId}:${problemId}:java`;
  // Each scope owns its pending reads/writes. Cleanup can flush the old scope
  // without accidentally saving the next exercise's code under the old ID.
  const context = useMemo(() => ({
    ...options, revision: 0, ready: false, lastSaved: null as string | null, lastSavedAt: null as string | null, draftEdit: null as string | null,
    retrieving: false, active: false, loading: true,
  }), [scope]); // The remaining fields track current values below, without restarting the timer.
  useLayoutEffect(() => {
    if (context.code !== code) context.revision += 1;
    Object.assign(context, options);
  });
  const [state, setState] = useState<{ scope: string; progress: ProblemProgress | null; status: string; loading: boolean; saving: boolean; retrieving: boolean }>(
    { scope, progress: null, status: "", loading: Boolean(userId && problemId), saving: false, retrieving: false },
  );
  const update = (value: Partial<typeof state>) => {
    if (context.active) setState(current => current.scope === scope ? { ...current, ...value } : current);
  };

  useEffect(() => {
    if (!userId || !problemId) return;
    let active = true;
    context.active = true;
    context.ready = false;
    context.loading = true;
    setState({ scope, progress: null, status: "Loading saved draft…", loading: true, saving: false, retrieving: false });
    const updateCurrent = (value: Partial<typeof state>) => {
      if (active) setState(current => current.scope === scope ? { ...current, ...value } : current);
    };
    async function save(): Promise<void> {
      if (context.draftEdit === null) return;
      const previousSave = pendingDraftWrites.get(persistenceScope);
      const currentWrite = (async () => {
        await previousSave;
        await read;
        const savedCode = context.draftEdit;
        if (!context.ready || savedCode === null || savedCode === context.lastSaved) return;
        updateCurrent({ saving: true, status: "Saving draft…" });
        try {
          const { data, error } = await supabase.rpc("save_practice_draft", {
            p_user_id: userId, p_problem_id: problemId, p_draft_code: savedCode, p_expected_saved_at: context.lastSavedAt,
          });
          if (error) throw error;
          if (!data) {
            conflictingDrafts.set(persistenceScope, context.draftEdit ?? savedCode);
            updateCurrent({ status: "Your saved draft changed in another tab. This edit was not saved." });
            return;
          }
          const row = data as ProgressRow;
          if (conflictingDrafts.get(persistenceScope) === savedCode) conflictingDrafts.delete(persistenceScope);
          context.lastSaved = savedCode;
          context.lastSavedAt = row.last_saved_at;
          updateCurrent({ progress: progressFromRow(row), status: "Draft autosaved." });
        } catch {
          updateCurrent({ status: "Could not autosave draft. Your editor content is still here; the next autosave will retry." });
        } finally { updateCurrent({ saving: false }); }
      })();
      pendingDraftWrites.set(persistenceScope, currentWrite);
      await currentWrite;
      if (pendingDraftWrites.get(persistenceScope) === currentWrite) pendingDraftWrites.delete(persistenceScope);
    }
    const previousWrite = pendingDraftWrites.get(persistenceScope);
    const read = (async () => {
      try {
        await previousWrite;
        if (!active && context.draftEdit === null) return;
        const row = await readProgress(userId, problemId);
        context.lastSaved = javaDraft(row);
        context.lastSavedAt = row?.last_saved_at ?? null;
        context.ready = true;
        updateCurrent({ progress: row ? progressFromRow(row) : null, status: "Autosaves every 10 minutes when code changes." });
      } catch {
        updateCurrent({ status: "Could not load your saved draft. Autosave is paused to protect it. Reopen the room to retry." });
      } finally { if (active) context.loading = false; updateCurrent({ loading: false }); }
    })();
    const timer = setInterval(() => { if (!context.retrieving) void save(); }, autosaveMs);
    return () => {
      clearInterval(timer);
      // Normal in-app navigation also saves dirty code. Never flush starter
      // content before the saved draft has been read successfully.
      void save();
      active = false;
      context.active = false;
    };
  }, [context, scope, persistenceScope, userId, problemId]);

  function editCode(nextCode: string) {
    if (!context.active || !context.canEditCode || context.retrieving || nextCode === context.code) return;
    context.draftEdit = nextCode;
    context.revision += 1;
    context.code = nextCode;
    context.onCodeChange(nextCode);
  }

  async function replaceCode(load: () => Promise<string | null>, status: string, missing: string, onReplaced?: () => void) {
    if (!context.active || !context.canEditCode || !context.connected || context.loading || context.retrieving || !problemId) return;
    const { code: expectedCode, revision } = context;
    context.retrieving = true;
    update({ retrieving: true, status: "Preparing shared code replacement…" });
    try {
      const nextCode = await load();
      if (!context.active) return;
      if (nextCode === null) {
        update({ status: missing });
      } else if (!context.canEditCode || !context.connected || revision !== context.revision) {
        update({ status: "Code was not loaded because the shared editor or your edit permission changed. Try again." });
      } else {
        await context.onCodeReplace(problemId, expectedCode, nextCode);
        if (!context.active) return;
        onReplaced?.();
        update({ status });
      }
    } catch {
      update({ status: "Could not confirm the shared code replacement. Check the editor and try again." });
    } finally {
      context.retrieving = false;
      update({ retrieving: false });
    }
  }

  function restoreDraft() {
    if (!userId || !problemId || (context.lastSaved === null && !conflictingDrafts.has(persistenceScope))) return;
    let row: ProgressRow | null;
    return replaceCode(async () => {
      await pendingDraftWrites.get(persistenceScope);
      row = await readProgress(userId, problemId);
      return javaDraft(row);
    }, "Saved draft restored into the shared editor.", "No saved Java draft found for this exercise.", () => {
      const savedCode = javaDraft(row);
      if (context.draftEdit !== null && context.draftEdit !== context.lastSaved && context.draftEdit !== savedCode
        && context.lastSavedAt !== row?.last_saved_at) {
        conflictingDrafts.set(persistenceScope, context.draftEdit);
      }
      context.lastSaved = savedCode;
      context.lastSavedAt = row?.last_saved_at ?? null;
      context.draftEdit = null;
      update({ progress: row ? progressFromRow(row) : null });
    });
  }

  function resetCode() {
    const problem = context.problem;
    if (!problem) return;
    return replaceCode(async () => problem.starterCode, "Shared editor reset to the default Java definition.", "No default Java definition found.");
  }

  function retrieveSubmission() {
    if (!userId || !problemId) return;
    return replaceCode(async () => {
      const { data, error } = await supabase.from("submissions").select("source_code, created_at")
        .eq("user_id", userId).eq("problem_id", problemId).eq("language", "java").eq("verification", "leetcollab")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return typeof data?.source_code === "string" && data.source_code ? data.source_code : null;
    }, "Last submitted Java code restored into the shared editor.", "No submitted Java code found for this exercise.");
  }

  const current = state.scope === scope ? state : { progress: null, status: "Loading saved draft…", loading: true, saving: false, retrieving: false };
  return { ...current, conflictingDraft: conflictingDrafts.get(persistenceScope) ?? null, editCode, restoreDraft, resetCode, retrieveSubmission };
}
