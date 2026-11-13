"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { judgeStatusResponseSchema, judgeSubmissionResponseSchema, type JudgeStatusResponse } from "@leetcollab/contracts";
import { useAuth } from "./auth-provider";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";

export function PracticeControls({ problemId, code }: { problemId: string; code: string }) {
  const { session } = useAuth();
  if (!session) return null;
  return <SessionPracticeControls key={`${problemId}:${session.access_token}`} problemId={problemId} code={code} token={session.access_token} userId={session.user.id} />;
}

function SessionPracticeControls({ problemId, code, token, userId }: { problemId: string; code: string; token: string; userId: string }) {
  const mounted = useRef(false);
  const statusGeneration = useRef(0);
  const reviewGeneration = useRef(0);
  const completionGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [quota, setQuota] = useState<JudgeStatusResponse | null>(null);
  const [message, setMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completion, setCompletion] = useState<"loading" | "solved" | "unsolved" | "unavailable">("loading");
  const [reviewAt, setReviewAt] = useState<string | null>(null);
  const refreshStatus = useCallback(async () => {
    const generation = ++statusGeneration.current;
    try {
      const response = await fetch(`/api/judge/status?problemId=${problemId}`, { headers: { Authorization: `Bearer ${token}` } });
      const value = judgeStatusResponseSchema.parse(await response.json());
      if (mounted.current && generation === statusGeneration.current) {
        setQuota(value);
        setStatusError("");
      }
    } catch {
      if (mounted.current && generation === statusGeneration.current) { setQuota(null); setStatusError("Judge status unavailable. Refresh status to try again."); }
    }
  }, [problemId, token]);

  const refreshCompletion = useCallback(async () => {
    const generation = ++completionGeneration.current;
    try {
      // Submissions are server-owned. Historical client progress and grades are not evidence.
      const { data, error } = await supabase.from("submissions")
        .select("verification, judge_state, verdict, tests_passed, tests_total")
        .eq("user_id", userId).eq("problem_id", problemId)
        .eq("verification", "leetcollab").eq("judge_state", "completed").eq("verdict", "accepted");
      if (error) throw error;
      const solved = (data ?? []).some(row => row.verification === "leetcollab"
        && row.judge_state === "completed" && row.verdict === "accepted"
        && row.tests_total > 0 && row.tests_passed === row.tests_total);
      if (mounted.current && generation === completionGeneration.current) setCompletion(solved ? "solved" : "unsolved");
    } catch {
      if (mounted.current && generation === completionGeneration.current) setCompletion("unavailable");
    }
  }, [problemId, userId]);

  useEffect(() => {
    let current = true;
    void refreshStatus();
    void refreshCompletion();
    const generation = reviewGeneration.current;
    supabase.from("user_problem_progress").select("suggested_review_at").eq("user_id", userId).eq("problem_id", problemId).maybeSingle()
      .then(({ data }) => { if (current && generation === reviewGeneration.current) setReviewAt(data?.suggested_review_at ?? null); });
    return () => { current = false; };
  }, [problemId, userId, refreshStatus, refreshCompletion]);

  useEffect(() => {
    if (!quota || busy) return;
    const delay = new Date(quota.resetAt).getTime() - Date.now();
    const timer = setTimeout(() => { setQuota(null); void refreshStatus(); }, Math.max(1000, delay));
    return () => clearTimeout(timer);
  }, [quota, busy, refreshStatus]);

  async function run() {
    if (busy || !quota?.available) return;
    statusGeneration.current += 1;
    setQuota(null);
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
      await Promise.all([refreshStatus(), refreshCompletion()]);
    } catch { if (mounted.current) { setQuota(null); setMessage("Judge unavailable. Refresh status before trying again."); } }
    finally { if (mounted.current) setBusy(false); }
  }

  async function grade(value: string) {
    reviewGeneration.current += 1;
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

  return <div className="practice-controls">
    <Button size="sm" variant="secondary" disabled={busy || !quota?.available} onClick={run} type="button">{busy ? "Working…" : "Run"}</Button>
    <Button size="sm" disabled={busy || !quota?.available} onClick={run} type="button">Submit</Button>
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => { void refreshStatus(); void refreshCompletion(); }} type="button">Refresh status</Button>
    <p>Run and Submit both judge all test cases and save a submission. Only a LeetCollab-verified pass marks this problem solved.</p>
    <p role="status">{completion === "solved" ? "Solved - LeetCollab verified" : completion === "unavailable" ? "Completion status unavailable. Refresh status to try again." : completion === "loading" ? "Loading completion status…" : "Not solved"}</p>
    {quota && <p>{quota.remaining} of {quota.limit} shared executions remaining. Reset: {new Date(quota.resetAt).toLocaleString()}. {quota.unavailableReason === "provider_unconfigured" ? "External sandbox is not configured." : ""}</p>}
    {quota?.unavailableReason === "quota_exhausted" && (quota.fallback ? <p><a href={quota.fallback.url} target="_blank" rel="noreferrer">Practice on {quota.fallback.name}</a>. External results are not LeetCollab-verified.</p> : <p>This original exercise must wait for quota reset.</p>)}
    <div>Personal review grade: {(["again", "hard", "good", "easy"] as const).map(value => <Button size="sm" variant="secondary" key={value} disabled={busy} onClick={() => grade(value)} type="button">{value}</Button>)}</div>
    <p>Personal grades schedule your next review: again in 1 day, hard in 3, good in 7, easy in 14. They do not mark a problem solved.</p>
    {reviewAt && <p>Suggested review: {new Date(reviewAt).toLocaleString()}. Repeat practice is voluntary.</p>}
    {message && <p role="status">{message}</p>}
    {statusError && <p role="status">{statusError}</p>}
  </div>;
}
