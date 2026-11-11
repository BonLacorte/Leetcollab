"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { judgeStatusResponseSchema, judgeSubmissionResponseSchema, type JudgeStatusResponse } from "@leetcollab/contracts";
import { useAuth } from "./auth-provider";
import { supabase } from "../lib/supabase";

export function PracticeControls({ problemId, code }: { problemId: string; code: string }) {
  const { session } = useAuth();
  if (!session) return null;
  return <SessionPracticeControls key={`${problemId}:${session.access_token}`} problemId={problemId} code={code} token={session.access_token} userId={session.user.id} />;
}

function SessionPracticeControls({ problemId, code, token, userId }: { problemId: string; code: string; token: string; userId: string }) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [quota, setQuota] = useState<JudgeStatusResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewAt, setReviewAt] = useState<string | null>(null);
  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/judge/status?problemId=${problemId}`, { headers: { Authorization: `Bearer ${token}` } });
      const value = judgeStatusResponseSchema.parse(await response.json());
      if (mounted.current) setQuota(value);
    } catch {
      if (mounted.current) { setQuota(null); setMessage("Judge status unavailable. Refresh status to try again."); }
    }
  }, [problemId, token]);

  useEffect(() => {
    let current = true;
    void refreshStatus();
    supabase.from("user_problem_progress").select("suggested_review_at").eq("user_id", userId).eq("problem_id", problemId).maybeSingle()
      .then(({ data }) => { if (current) setReviewAt(data?.suggested_review_at ?? null); });
    return () => { current = false; };
  }, [problemId, userId, refreshStatus]);

  useEffect(() => {
    if (!quota) return;
    const delay = new Date(quota.resetAt).getTime() - Date.now();
    const timer = setTimeout(() => { setQuota(null); void refreshStatus(); }, Math.max(1000, delay));
    return () => clearTimeout(timer);
  }, [quota, refreshStatus]);

  async function run() {
    if (busy || !quota?.available) return;
    setBusy(true);
    try {
      const response = await fetch("/api/judge/submissions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ problemId, sourceCode: code, language: "java", idempotencyKey: crypto.randomUUID() }),
      });
      const result = judgeSubmissionResponseSchema.parse(await response.json());
      if (!mounted.current) return;
      setMessage(result.ok ? `LeetCollab verdict: ${result.submission.verdict}` : result.error.message);
      setQuota(null);
      await refreshStatus();
    } catch { if (mounted.current) { setQuota(null); setMessage("Judge unavailable. Refresh status before trying again."); } }
    finally { if (mounted.current) setBusy(false); }
  }

  async function grade(value: string) {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("record_problem_grade", { p_problem_id: problemId, p_grade: value });
      if (!mounted.current) return;
      if (error) throw error;
      setReviewAt(data?.[0]?.suggested_review_at ?? null);
      setMessage(`Personal grade saved: ${value}`);
    } catch { if (mounted.current) setMessage("Could not save grade."); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <div className="editor-progress">
    <button disabled={busy || !quota?.available} onClick={run} type="button">{busy ? "Working…" : "Run Java"}</button>
    <button className="secondary" disabled={busy} onClick={() => { void refreshStatus(); }} type="button">Refresh status</button>
    {quota && <p>{quota.remaining} of {quota.limit} shared executions remaining. Reset: {new Date(quota.resetAt).toLocaleString()}. {quota.unavailableReason === "provider_unconfigured" ? "External sandbox is not configured." : ""}</p>}
    {quota?.unavailableReason === "quota_exhausted" && (quota.fallback ? <p><a href={quota.fallback.url} target="_blank" rel="noreferrer">Practice on {quota.fallback.name}</a>. External results are not LeetCollab-verified.</p> : <p>This original exercise must wait for quota reset.</p>)}
    <div>Personal review grade: {(["again", "hard", "good", "easy"] as const).map(value => <button className="secondary" key={value} disabled={busy} onClick={() => grade(value)} type="button">{value}</button>)}</div>
    {reviewAt && <p>Suggested review: {new Date(reviewAt).toLocaleString()}. Repeat practice is voluntary.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
