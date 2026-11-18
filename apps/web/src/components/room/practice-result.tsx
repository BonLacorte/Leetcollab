import type { JudgeSubmissionResponse, JudgeVerdict } from "@leetcollab/contracts";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { compilerCountLabel, sourceDiagnostics, type PublicCase, type StructuredSubmission } from "./execution-feedback";

export type PracticeExecution = { action: "Run" | "Submit"; sourceCode: string; codeVersion: number } & (
  | { state: "running" }
  | { state: "finished"; response: JudgeSubmissionResponse }
  | { state: "unavailable" }
);

const verdictLabels: Record<JudgeVerdict, string> = {
  accepted: "Accepted", wrong_answer: "Wrong Answer", compile_error: "Compile Error",
  runtime_error: "Runtime Error", time_limit: "Time Limit Exceeded",
  memory_limit: "Memory Limit Exceeded", output_limit: "Output Limit Exceeded",
};

function CompilerFeedback({ submission, source }: { submission: StructuredSubmission; source: string }) {
  const diagnostics = sourceDiagnostics(submission, source);
  const lines = source.split(/\r\n?|\n/);
  return <div className="compiler-feedback">
    {diagnostics.length ? <ol className="compiler-diagnostics" aria-label="Compiler diagnostics">
      {diagnostics.map((diagnostic, index) => {
        const line = lines[diagnostic.line - 1];
        const at = diagnostic.column ? diagnostic.column - 1 : null;
        const width = at !== null && (line.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
        return <li key={index}>
          <p className="compiler-diagnostic-message"><strong>Line {diagnostic.line}{diagnostic.column ? `:${diagnostic.column}` : ""}:</strong> {diagnostic.message}</p>
          <pre className="compiler-source" aria-label={`Submitted source, line ${diagnostic.line}`}><code>{at === null ? line : <>{line.slice(0, at)}<mark>{line.slice(at, at + width)}</mark>{line.slice(at + width)}</>}</code></pre>
        </li>;
      })}
    </ol> : <pre className="execution-diagnostics">{submission.diagnostics || "Java compilation failed. Detailed compiler diagnostics are unavailable."}</pre>}
    {diagnostics.length > 0 && submission.compilerDiagnosticsComplete === false && <p className="muted compiler-diagnostic-note">This result contains partial compiler diagnostics.</p>}
    <p className="compiler-error-count">{compilerCountLabel(submission, diagnostics.length)}</p>
  </div>;
}

function PublicCaseResults({ cases }: { cases: PublicCase[] }) {
  return <section className="public-case-results" aria-label="Public testcase results">
    <h3>Public testcases</h3>
    <Tabs defaultValue="case-0" className="public-case-tabs">
      <TabsList aria-label="Public testcases">
        {cases.map((testcase, index) => <TabsTrigger key={`${testcase.id}:${index}`} value={`case-${index}`} className={`public-case-tab ${testcase.passed === true ? "is-passed" : testcase.passed === false ? "is-failed" : "is-unavailable"}`}>
          {testcase.passed === true ? <CheckCircle2 aria-hidden="true" /> : testcase.passed === false ? <XCircle aria-hidden="true" /> : <Circle aria-hidden="true" />}
          Case {index + 1}<span className="sr-only">: {testcase.passed === true ? "Passed" : testcase.passed === false ? "Failed" : "Result unavailable"}</span>
        </TabsTrigger>)}
      </TabsList>
      {cases.map((testcase, index) => <TabsContent key={`${testcase.id}:${index}`} value={`case-${index}`} className="public-case-detail">
        <div className="public-case-heading"><strong>{testcase.title}</strong><span className={testcase.passed === true ? "success" : testcase.passed === false ? "error" : "muted"}>{testcase.passed === true ? "Passed" : testcase.passed === false ? "Failed" : "Result unavailable"}</span></div>
        <dl>
          <div><dt>Input</dt><dd><pre>{testcase.input || "(empty input)"}</pre></dd></div>
          <div><dt>Output</dt><dd><pre>{testcase.output === null ? "Not available" : testcase.output || "(empty output)"}</pre></dd></div>
          <div><dt>Expected</dt><dd><pre>{testcase.expected || "(empty output)"}</pre></dd></div>
        </dl>
      </TabsContent>)}
    </Tabs>
    <p className="muted public-case-note">Only public examples are shown. Private checks are included in the overall total.</p>
  </section>;
}

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
  const submission: StructuredSubmission | null = response?.ok ? response.submission : null;
  const title = submission ? verdictLabels[submission.verdict]
    : response && !response.ok && ["INVALID_REQUEST", "UNSAFE_SOURCE"].includes(response.error.code) ? "Submission Rejected"
    : response && !response.ok && response.error.code === "QUOTA_EXHAUSTED" ? "Execution Limit Reached"
    : response && !response.ok && response.error.code === "BUSY" ? "Judge Busy" : "Judge Unavailable";
  const diagnostics = submission
    ? submission.diagnostics || (submission.verdict === "compile_error"
      ? "Java compilation failed. The judge did not return detailed compiler diagnostics."
      : "No further diagnostics were returned.")
    : response && !response.ok ? response.error.message : "Judge unavailable. Refresh status before trying again.";

  return <section className={`execution-result ${submission?.verdict === "accepted" ? "is-accepted" : "is-error"}`}>
    <div className="execution-verdict" role="status" aria-atomic="true">
      <p className="muted">{execution.action} · {submission ? "LeetCollab verdict" : "Execution request"}</p>
      <h2>{title}</h2>
      {submission && <p className="execution-summary">
        {(submission.verdict === "accepted" || submission.verdict === "wrong_answer") && <span>{submission.testsPassed} of {submission.testsTotal} checks passed · {Math.max(0, submission.testsTotal - submission.testsPassed)} failed</span>}
        {submission.durationMs !== null && <span>Duration: {submission.durationMs} ms</span>}
      </p>}
    </div>
    {submission?.verdict === "compile_error"
      ? <CompilerFeedback submission={submission} source={execution.sourceCode} />
      : !(submission?.publicCases?.length && ["accepted", "wrong_answer"].includes(submission.verdict)) && <pre className="execution-diagnostics">{diagnostics}</pre>}
    {submission?.publicCases?.length ? <PublicCaseResults key={submission.id} cases={submission.publicCases} />
      : submission && ["accepted", "wrong_answer"].includes(submission.verdict) && <p className="muted">Public testcase details are not available for this submission.</p>}
  </section>;
}
