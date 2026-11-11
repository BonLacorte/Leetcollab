"use client";

import { useEffect, useState } from "react";
import { judgeStatusResponseSchema, judgeSubmissionResponseSchema, type JudgeStatusResponse } from "@leetcollab/contracts";
import { useAuth } from "./auth-provider";
import { supabase } from "../lib/supabase";

export function PracticeControls({ problemId, code }: { problemId: string; code: string }) {
  const { session } = useAuth();
  const [quota, setQuota] = useState<JudgeStatusResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewAt, setReviewAt] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setQuota(null);
    setMessage("");
    setReviewAt(null);
    if (session) {
      fetch(`/api/judge/status?problemId=${problemId}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(async response => judgeStatusResponseSchema.parse(await response.json()))
        .then(value => { if (current) setQuota(value); })
        .catch(() => { if (current) setMessage("Judge status unavailable."); });
      supabase.from("user_problem_progress").select("suggested_review_at").eq("user_id", session.user.id).eq("problem_id", problemId).maybeSingle()
        .then(({ data }) => { if (current) setReviewAt(data?.suggested_review_at ?? null); });
    }
    return () => { current = false; };
  }, [problemId, session]);

  async function run() {
    if (!session || busy || !quota?.available) return;
    setBusy(true);
    try {
      const response = await fetch("/api/judge/submissions", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ problemId, sourceCode: code, language: "java", idempotencyKey: crypto.randomUUID() }),
      });
      const result = judgeSubmissionResponseSchema.parse(await response.json());
      setMessage(result.ok ? `LeetCollab verdict: ${result.submission.verdict}` : result.error.message);
      setQuota(null);
      const status = await fetch(`/api/judge/status?problemId=${problemId}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      setQuota(judgeStatusResponseSchema.parse(await status.json()));
    } catch { setQuota(null); setMessage("Judge unavailable. Check status before trying again."); }
    finally { setBusy(false); }
  }

  async function grade(value: string) {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("record_problem_grade", { p_problem_id: problemId, p_grade: value });
      if (error) throw error;
      setReviewAt(data?.[0]?.suggested_review_at ?? null);
      setMessage(`Personal grade saved: ${value}`);
    } catch { setMessage("Could not save grade."); }
    finally { setBusy(false); }
  }

  return <div className="editor-progress">
    <button disabled={busy || !quota?.available} onClick={run} type="button">{busy ? "Working…" : "Run Java"}</button>
    {quota && <p>{quota.remaining} of {quota.limit} shared executions remaining. Reset: {new Date(quota.resetAt).toLocaleString()}. {quota.unavailableReason === "provider_unconfigured" ? "External sandbox is not configured." : ""}</p>}
    {quota?.unavailableReason === "quota_exhausted" && (quota.fallback ? <p><a href={quota.fallback.url} target="_blank" rel="noreferrer">Practice on {quota.fallback.name}</a>. External results are not LeetCollab-verified.</p> : <p>This original exercise must wait for quota reset.</p>)}
    <div>Personal review grade: {(["again", "hard", "good", "easy"] as const).map(value => <button className="secondary" key={value} disabled={busy} onClick={() => grade(value)} type="button">{value}</button>)}</div>
    {reviewAt && <p>Suggested review: {new Date(reviewAt).toLocaleString()}. Repeat practice is voluntary.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
