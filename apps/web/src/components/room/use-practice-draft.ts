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

function progressFromRow(row: ProgressRow): ProblemProgress {
  return { userId: row.user_id, problemId: row.problem_id, draftCode: row.draft_code ?? "",
    draftLanguage: row.draft_language ?? "java", lastSavedAt: row.last_saved_at, solvedAt: row.solved_at,
    solvedWith: Array.isArray(row.solved_with) ? row.solved_with : [], solvedCode: row.solved_code };
}

type Options = {
  roomId: string; userId?: string; problem: Problem | null; code: string;
  canEditCode: boolean; connected: boolean; onCodeChange: (code: string) => void;
};

export function usePracticeDraft(options: Options) {
  const { roomId, userId, problem, code } = options;
  const problemId = problem?.id;
  const scope = `${roomId}:${userId}:${problemId}:java`;
  const persistenceScope = `${userId}:${problemId}:java`;
  // Each scope owns its pending reads/writes. Cleanup can flush the old scope
  // without accidentally saving the next exercise's code under the old ID.
  const context = useMemo(() => ({
    ...options, revision: 0, ready: false, lastSaved: null as string | null, draftEdit: null as string | null,
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
    let pendingSave: Promise<void> | null = null;
    const updateCurrent = (value: Partial<typeof state>) => {
      if (active) setState(current => current.scope === scope ? { ...current, ...value } : current);
    };
    async function save(): Promise<void> {
      if (!context.ready || !context.canEditCode || !context.connected || context.draftEdit === null || context.draftEdit === context.lastSaved) return;
      if (pendingSave) { await pendingSave; return save(); }
      const savedCode = context.draftEdit;
      updateCurrent({ saving: true, status: "Saving draft…" });
      const previousWrite = pendingDraftWrites.get(persistenceScope);
      pendingSave = (async () => {
        await previousWrite;
        try {
          const { data, error } = await supabase.from("user_problem_progress").upsert({
            user_id: userId, problem_id: problemId, draft_code: savedCode, draft_language: "java", last_saved_at: new Date().toISOString(),
          }, { onConflict: "user_id,problem_id" }).select(progressSelect).single();
          if (error || !data) throw error ?? new Error("Missing saved draft");
          context.lastSaved = savedCode;
          updateCurrent({ progress: progressFromRow(data as ProgressRow), status: "Draft autosaved." });
        } catch {
          updateCurrent({ status: "Could not autosave draft. Your editor content is still here; the next autosave will retry." });
        } finally { updateCurrent({ saving: false }); }
      })();
      const currentWrite = pendingSave;
      pendingDraftWrites.set(persistenceScope, currentWrite);
      await currentWrite;
      if (pendingDraftWrites.get(persistenceScope) === currentWrite) pendingDraftWrites.delete(persistenceScope);
      pendingSave = null;
    }
    void (async () => {
      try {
        while (pendingDraftWrites.has(persistenceScope)) await pendingDraftWrites.get(persistenceScope);
        if (!active) return;
        const { data, error } = await supabase.from("user_problem_progress").select(progressSelect)
          .eq("user_id", userId).eq("problem_id", problemId).maybeSingle();
        if (!active) return;
        if (error) throw error;
        const row = data as ProgressRow | null;
        const hasDraft = Boolean(row?.last_saved_at && row.draft_language === "java" && typeof row.draft_code === "string");
        context.lastSaved = hasDraft ? row!.draft_code : null;
        context.ready = true;
        updateCurrent({ progress: row ? progressFromRow(row) : null, status: "Autosaves every 10 minutes when code changes." });
      } catch {
        updateCurrent({ status: "Could not load your saved draft. Autosave is paused to protect it. Reopen the room to retry." });
      } finally { if (active) context.loading = false; updateCurrent({ loading: false }); }
    })();
    const timer = setInterval(() => { void save(); }, autosaveMs);
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
    if (!context.active || !context.canEditCode || nextCode === context.code) return;
    context.draftEdit = nextCode;
    context.revision += 1;
    context.code = nextCode;
    context.onCodeChange(nextCode);
  }

  function restoreDraft() {
    if (!context.active || !context.canEditCode || !context.connected || context.loading || context.retrieving
      || context.lastSaved === null) return;
    context.revision += 1;
    context.draftEdit = null;
    context.code = context.lastSaved;
    context.onCodeChange(context.code);
    update({ status: "Saved draft restored into the shared editor." });
  }

  function resetCode() {
    if (!context.active || !context.canEditCode || !context.connected || context.loading || context.retrieving || !context.problem) return;
    context.revision += 1;
    context.code = context.problem.starterCode;
    context.onCodeChange(context.code);
    update({ status: "Shared editor reset to the default Java definition." });
  }

  async function retrieveSubmission() {
    if (!context.active || !context.canEditCode || !context.connected || context.loading || context.retrieving || !userId || !problemId) return;
    const revision = context.revision;
    context.retrieving = true;
    update({ retrieving: true, status: "Retrieving last submitted Java code…" });
    try {
      const { data, error } = await supabase.from("submissions").select("source_code, created_at")
        .eq("user_id", userId).eq("problem_id", problemId).eq("language", "java").eq("verification", "leetcollab")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
      if (!context.active) return;
      if (error) throw error;
      if (!data || typeof data.source_code !== "string" || !data.source_code) {
        update({ status: "No submitted Java code found for this exercise." });
      } else if (!context.canEditCode || !context.connected || revision !== context.revision) {
        update({ status: "Submitted code was not loaded because the shared editor or your edit permission changed. Try again." });
      } else {
        context.revision += 1;
        context.code = data.source_code;
        context.onCodeChange(context.code);
        update({ status: "Last submitted Java code restored into the shared editor." });
      }
    } catch { update({ status: "Could not retrieve submitted code. Your editor content was kept. Try again." }); }
    finally { context.retrieving = false; update({ retrieving: false }); }
  }

  const current = state.scope === scope ? state : { progress: null, status: "Loading saved draft…", loading: true, saving: false, retrieving: false };
  return { ...current, editCode, restoreDraft, resetCode, retrieveSubmission };
}
