import type { JudgeSubmissionResponse, JudgeVerdict } from "@leetcollab/contracts";

export type PracticeExecution = { action: "Run" | "Submit" } & (
  | { state: "running" }
  | { state: "finished"; response: JudgeSubmissionResponse }
  | { state: "unavailable" }
);

const verdictLabels: Record<JudgeVerdict, string> = {
  accepted: "Accepted", wrong_answer: "Wrong Answer", compile_error: "Compile Error",
  runtime_error: "Runtime Error", time_limit: "Time Limit Exceeded",
  memory_limit: "Memory Limit Exceeded", output_limit: "Output Limit Exceeded",
};

export function PracticeResult({ execution }: { execution: PracticeExecution | null }) {
  if (!execution) return <div className="empty-panel">
    <strong>Run or submit your solution</strong>
    <p className="muted">Your verdict and code diagnostics will appear here. Execution requires the external sandbox to be configured.</p>
  </div>;

  if (execution.state === "running") return <section className="execution-result" role="status" aria-busy="true">
    <p className="muted">{execution.action} · LeetCollab</p>
    <h2>Judging solution…</h2>
    <p className="muted">Waiting for the judge to finish.</p>
  </section>;

  const response = execution.state === "finished" ? execution.response : null;
  const submission = response?.ok ? response.submission : null;
  const title = submission ? verdictLabels[submission.verdict]
    : response && !response.ok && ["INVALID_REQUEST", "UNSAFE_SOURCE"].includes(response.error.code) ? "Submission Rejected"
    : response && !response.ok && response.error.code === "QUOTA_EXHAUSTED" ? "Execution Limit Reached"
    : response && !response.ok && response.error.code === "BUSY" ? "Judge Busy" : "Judge Unavailable";
  const diagnostics = submission
    ? submission.diagnostics || (submission.verdict === "compile_error"
      ? "Java compilation failed. The judge did not return detailed compiler diagnostics."
      : "No further diagnostics were returned.")
    : response && !response.ok ? response.error.message : "Judge unavailable. Refresh status before trying again.";

  return <section className={`execution-result ${submission?.verdict === "accepted" ? "is-accepted" : "is-error"}`} role="status" aria-atomic="true">
    <p className="muted">{execution.action} · {submission ? "LeetCollab verdict" : "Execution request"}</p>
    <h2>{title}</h2>
    {submission && <p className="execution-summary">
      {(submission.verdict === "accepted" || submission.verdict === "wrong_answer") && <span>{submission.testsPassed} of {submission.testsTotal} checks passed</span>}
      {submission.durationMs !== null && <span>Duration: {submission.durationMs} ms</span>}
    </p>}
    <pre className="execution-diagnostics">{diagnostics}</pre>
  </section>;
}
