"use client";

import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import { judgeStatusResponseSchema, judgeSubmissionResponseSchema, type JudgeStatusResponse } from "@leetcollab/contracts";
import { useAuth } from "./auth-provider";
import { useSocket } from "./socket-provider";
import { supabase } from "../lib/supabase";
import { CheckCircle2, Circle, Play, RotateCw, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import type { PracticeExecution } from "./room/practice-result";

const reviewGrades = [
  { value: "again", days: 1 }, { value: "hard", days: 3 },
  { value: "good", days: 7 }, { value: "easy", days: 14 },
] as const;

type PracticeControlsProps = {
  problemId: string;
  roomId: string;
  code: string;
  codeVersion?: number;
  codePending?: boolean;
  onExecutionChange: (execution: PracticeExecution) => void;
};

export function PracticeControls({ problemId, roomId, code, codeVersion = 0, codePending, onExecutionChange }: PracticeControlsProps) {
  const { session } = useAuth();
  if (!session) return null;
  return <SessionPracticeControls key={`${problemId}:${session.user.id}`} problemId={problemId} roomId={roomId} code={code} codeVersion={codeVersion} codePending={codePending} token={session.access_token} userId={session.user.id} onExecutionChange={onExecutionChange} />;
}

function SessionPracticeControls({ problemId, roomId, code, codeVersion = 0, codePending, token, userId, onExecutionChange }: PracticeControlsProps & { token: string; userId: string }) {
  const socket = useSocket();
  const mounted = useRef(false);
  const statusGeneration = useRef(0);
  const reviewGeneration = useRef(0);
  const completionGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [quota, setQuota] = useState<JudgeStatusResponse | null>(null);
  const [provider, setProvider] = useState<JudgeStatusResponse["provider"]>();
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
        setProvider(value.provider);
        setStatusError("");
      }
    } catch {
      if (mounted.current && generation === statusGeneration.current) { setQuota(null); setStatusError("Judge status unavailable. Refresh status to try again."); }
    }
  }, [problemId, token]);

  const currentRefreshStatus = useRef(refreshStatus);
  useLayoutEffect(() => { currentRefreshStatus.current = refreshStatus; }, [refreshStatus]);

  const refreshCompletion = useCallback(async () => {
    const generation = ++completionGeneration.current;
    try {
      // Protected credits reference real accepted Submits, including room credit.
      const { data, error } = await supabase.rpc("has_verified_problem_solve", { p_problem_id: problemId });
      if (error || typeof data !== "boolean") throw error ?? new Error("Invalid completion status.");
      if (mounted.current && generation === completionGeneration.current) setCompletion(data ? "solved" : "unsolved");
    } catch {
      if (mounted.current && generation === completionGeneration.current) setCompletion("unavailable");
    }
  }, [problemId]);

  useEffect(() => {
    const refresh = () => { void refreshCompletion(); };
    const onRoomCredit = (event: { problemId: string }) => { if (event.problemId === problemId) refresh(); };
    socket?.on("practice:refresh", onRoomCredit);
    socket?.on("connect", refresh);
    if (typeof window !== "undefined") window.addEventListener("focus", refresh);
    return () => {
      socket?.off("practice:refresh", onRoomCredit);
      socket?.off("connect", refresh);
      if (typeof window !== "undefined") window.removeEventListener("focus", refresh);
    };
  }, [socket, problemId, refreshCompletion]);

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

  async function run(action: "Run" | "Submit") {
    if (busy || codePending || !quota?.available) return;
    statusGeneration.current += 1;
    setQuota(null);
    setBusy(true);
    const snapshot = { action, sourceCode: code, codeVersion };
    onExecutionChange({ ...snapshot, state: "running" });
    try {
      const response = await fetch("/api/judge/submissions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ problemId, action: action === "Submit" ? "submit" : "run", ...(action === "Submit" ? { roomId } : {}), sourceCode: snapshot.sourceCode, language: "java", idempotencyKey: crypto.randomUUID() }),
      });
      const result = judgeSubmissionResponseSchema.parse(await response.json());
      if (result.ok && result.submission.problemId !== problemId) throw new Error("Submission belongs to another exercise.");
      if (!mounted.current) return;
      onExecutionChange({ ...snapshot, state: "finished", response: result });
      setQuota(null);
      await Promise.all([currentRefreshStatus.current(), refreshCompletion()]);
    } catch { if (mounted.current) { setQuota(null); onExecutionChange({ ...snapshot, state: "unavailable" }); } }
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

  const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(value));

  return <div className="practice-controls">
    {provider === "onlinecompiler" && <p className="execution-notice">
      <ShieldCheck aria-hidden="true" />
      <span><strong>External execution · OnlineCompiler.io</strong>{" "}
        Run and Submit send your Java code and the exercise harness to OnlineCompiler.io. Execution code, input and output are retained for 365 days. Do not include secrets or sensitive information.{" "}
        <a href="https://onlinecompiler.io/privacy" target="_blank" rel="noreferrer">Privacy policy</a>{" · "}
        <a href="https://onlinecompiler.io/terms" target="_blank" rel="noreferrer">Terms of service</a>.
      </span>
    </p>}
    <section className="practice-execution" aria-label="Execution">
      <div className="practice-action-row">
        <div className="practice-actions">
          <Button size="sm" variant="secondary" disabled={busy || codePending || !quota?.available} onClick={() => run("Run")} type="button"><Play aria-hidden="true" />{busy ? "Working…" : "Run"}</Button>
          <Button size="sm" disabled={busy || codePending || !quota?.available} onClick={() => run("Submit")} type="button">Submit</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void refreshStatus(); void refreshCompletion(); }} type="button"><RotateCw aria-hidden="true" />Refresh status</Button>
        </div>
        <p className={`practice-completion${completion === "solved" ? " is-solved" : ""}`} role="status">
          {completion === "solved" ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
          {completion === "solved" ? "Solved - LeetCollab verified" : completion === "unavailable" ? "Completion status unavailable. Refresh status to try again." : completion === "loading" ? "Loading completion status…" : "Not solved"}
        </p>
      </div>
      <p className="practice-help">Run tests your code. An accepted Submit marks the problem solved for you{quota?.quotaScope === "user" ? " and the room members present when you submit" : ""}.</p>
      <div className={`practice-quota${quota?.unavailableReason === "quota_exhausted" ? " is-exhausted" : statusError ? " is-error" : ""}`} role="status">
        {quota ? <>
          <p><strong>{quota.remaining} of {quota.limit}</strong> executions remaining{quota.quotaScope === "shared" ? " in the shared allowance" : quota.quotaScope === "user" ? " in your allowance" : ""}</p>
          <p className="practice-reset">Resets <time dateTime={quota.resetAt}>{formatTime(quota.resetAt)}</time></p>
          {quota.unavailableReason === "provider_unconfigured" && <p className="practice-quota-detail">External sandbox is not configured.</p>}
          {quota.unavailableReason === "quota_exhausted" && (quota.fallback ? <p className="practice-quota-detail"><a href={quota.fallback.url} target="_blank" rel="noreferrer">Practice on {quota.fallback.name}</a>. External results are not LeetCollab-verified.</p> : <p className="practice-quota-detail">This original exercise must wait for quota reset.</p>)}
        </> : <p>{statusError || (busy ? "Updating execution status…" : "Loading execution allowance…")}</p>}
      </div>
    </section>
    <section className="practice-review" aria-label="Personal review">
      <div className="practice-review-copy">
        <h3>Personal review</h3>
        <p className="practice-help">Grade to schedule your next review. Grades do not mark a problem solved.</p>
      </div>
      <div className="practice-grades" role="group" aria-label="Personal review grade">
        {reviewGrades.map(({ value, days }) => <Button className="practice-grade" size="sm" variant="outline" key={value} disabled={busy} onClick={() => grade(value)} type="button" aria-label={`${value}, review in ${days} ${days === 1 ? "day" : "days"}`}>
          {value}<span>{days}{days === 1 ? " day" : " days"}</span>
        </Button>)}
      </div>
      {reviewAt && <p className="practice-review-next">Suggested review: <time dateTime={reviewAt}>{formatTime(reviewAt)}</time>. Repeat practice is voluntary.</p>}
    </section>
    {message && <p className="practice-feedback" role="status">{message}</p>}
  </div>;
}
