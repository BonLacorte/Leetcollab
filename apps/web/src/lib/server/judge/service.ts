import type {
  JudgeErrorCode,
  JudgeQuota,
  JudgeStatusResponse,
  JudgeSubmissionRequest,
  JudgeSubmissionResponse,
  JudgeVerdict,
  JudgePublicCase,
} from "@leetcollab/contracts";
import { assertEvaluationAdmission, type JudgeEvaluation } from "./evaluation";
import { buildJavaProgram, validateJavaSource } from "./safety";
import { compilerSummary, publicCompilerReport, publicExecutionDiagnostics, type CompilerReport } from "./diagnostics";
import { casePassed, framedHarness, publicCaseResults, readCaseOutputs } from "./public-cases";
import {
  ProviderFailure,
  type ExecutionProvider,
  type JudgeCompletion,
  type JudgeRepository,
  type QuotaPeriod,
  type StoredSubmission,
  type SubmissionParticipants,
} from "./types";

type ServiceResponse = { status: number; body: JudgeSubmissionResponse };

export type JudgeServiceOptions = {
  quotaLimit?: number;
  // Server composition permits this only in development with a loopback database.
  localTesting?: boolean;
  captureParticipants?: (roomId?: string) => Promise<SubmissionParticipants>;
  notifyCompletion?: (submissionId: string) => Promise<void>;
  activeLimit?: number;
  reservationSeconds?: number;
  now?: () => Date;
  evaluation?: JudgeEvaluation;
  // Offline injection only. Production composition never supplies this.
  renderPolicyId?: string;
};

function quotaPeriod(now: Date): QuotaPeriod {
  // JDoodle's shared daily credit allowance resets at 23:55 UTC.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 55));
  if (now < start) start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function withRemaining(quota: Omit<JudgeQuota, "remaining">): JudgeQuota {
  return { ...quota, remaining: Math.max(0, quota.limit - quota.used) };
}

function normalizedLines(output: string): string[] {
  const normalized = output.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (normalized === "") return [""];
  return normalized.split("\n").map((line) => line.trimEnd());
}

function compareOutput(output: string, expected: string[]): { verdict: JudgeVerdict; passed: number } {
  const actual = normalizedLines(output);
  const passed = expected.reduce(
    (count, value, index) => count + (actual[index] === value ? 1 : 0),
    0,
  );
  const accepted = actual.length === expected.length && passed === expected.length;
  return { verdict: accepted ? "accepted" : "wrong_answer", passed };
}

function httpStatus(code: JudgeErrorCode): number {
  switch (code) {
    case "INVALID_REQUEST":
    case "UNSAFE_SOURCE":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "PROBLEM_NOT_FOUND":
      return 404;
    case "BUSY":
    case "QUOTA_EXHAUSTED":
      return 429;
    case "JUDGE_UNAVAILABLE":
      return 503;
  }
}

function errorResponse(
  code: JudgeErrorCode,
  message: string,
  quota?: JudgeQuota,
): ServiceResponse {
  return {
    status: httpStatus(code),
    body: { ok: false, error: { code, message }, ...(quota ? { quota } : {}) },
  };
}

function publicSubmission(
  submission: StoredSubmission, source: string, compiler?: CompilerReport, cases?: JudgePublicCase[],
): StoredSubmission {
  // Structured results are constructed here, never trusted from stored/raw data.
  const { compilerDiagnostics: _issues, compilerErrorCount: _count,
    compilerDiagnosticsComplete: _complete, publicCases: _cases, ...stored } = submission;
  return { ...stored, diagnostics: submission.verdict === "accepted"
    ? "All LeetCollab fixture checks passed."
    : submission.verdict === "wrong_answer"
      ? `${submission.testsPassed} of ${submission.testsTotal} LeetCollab fixture checks passed.`
      : publicExecutionDiagnostics(submission.verdict, source, submission.diagnostics),
    ...(submission.verdict === "compile_error" ? compiler ?? {
      // A replay has no retained raw report or verified source snapshot.
      compilerDiagnostics: [], compilerErrorCount: null, compilerDiagnosticsComplete: false,
    } : {}),
    ...(cases ? { publicCases: cases } : {}),
  };
}

function failedExisting(submission: StoredSubmission, quota: JudgeQuota, source: string): ServiceResponse {
  if (submission.judgeState === "failed") {
    return errorResponse(
      "JUDGE_UNAVAILABLE",
      "This attempt could not be completed by the external sandbox. Use a new submission key to try again.",
      quota,
    );
  }
  return { status: 200, body: { ok: true, submission: publicSubmission(submission, source), quota } };
}

export class JudgeService {
  private readonly quotaLimit: number;
  private readonly activeLimit: number;
  private readonly reservationSeconds: number;
  private readonly now: () => Date;
  private readonly renderPolicyId?: string;
  private readonly evaluation?: JudgeEvaluation;
  private readonly captureParticipants?: (roomId?: string) => Promise<SubmissionParticipants>;
  private readonly notifyCompletion?: (submissionId: string) => Promise<void>;

  constructor(
    private readonly repository: JudgeRepository,
    private readonly provider: ExecutionProvider,
    options: JudgeServiceOptions = {},
  ) {
    this.evaluation = options.evaluation;
    const maximum = options.evaluation ? 20 : options.localTesting && provider.id === "onlinecompiler" ? 50 : 25;
    this.quotaLimit = Math.min(maximum, Math.max(1, options.quotaLimit ?? 25));
    this.captureParticipants = options.captureParticipants;
    this.notifyCompletion = options.notifyCompletion;
    this.activeLimit = Math.max(1, options.activeLimit ?? 4);
    this.reservationSeconds = Math.min(120, Math.max(35, options.reservationSeconds ?? 45));
    if (options.renderPolicyId && !provider.provenance) throw new Error("Render policy requires Render provenance.");
    this.renderPolicyId = options.renderPolicyId;
    this.now = options.now ?? (() => new Date());
  }

  private assertAdmission(userId: string | undefined, problemId: string): void {
    assertEvaluationAdmission(this.evaluation, userId, problemId, this.now());
  }

  private async checkEvaluationQuota(userId: string | undefined, problemId: string): Promise<void> {
    this.assertAdmission(userId, problemId);
    if (!this.evaluation) return;
    const quota = await this.repository.readQuota(this.evaluation.period);
    // A stale baseline can only shrink the remaining allowance. A baseline above
    // actual usage could create extra slots and must be refused before mutation.
    if ((!quota && this.evaluation.baselineUsed !== 0)
      || (quota && (quota.used < this.evaluation.baselineUsed
        || (quota.used === this.evaluation.baselineUsed && quota.active !== 0)
        || quota.limit < this.evaluation.quotaLimit || quota.resetAt !== this.evaluation.period.end))) {
      throw new ProviderFailure("unavailable", "Judge evaluation budget is inconsistent.");
    }
    this.assertAdmission(userId, problemId);
  }

  async status(problemId: string, userId?: string): Promise<{ status: number; body: JudgeStatusResponse | { error: { code: JudgeErrorCode; message: string } } }> {
    await this.checkEvaluationQuota(userId, problemId);
    const config = await this.repository.getConfig(problemId);
    if (!config) {
      return { status: 404, body: { error: { code: "PROBLEM_NOT_FOUND", message: "Problem not found." } } };
    }

    this.assertAdmission(userId, problemId);
    const period = this.evaluation?.period ?? quotaPeriod(this.now());
    const { admission, ...quota } = await this.repository.getQuota(period, this.quotaLimit, this.renderPolicyId);
    this.assertAdmission(userId, problemId);
    const exhausted = quota.remaining === 0 || admission === "exhausted";
    const available = this.provider.configured && (!this.provider.provenance || Boolean(this.renderPolicyId))
      && (!admission || admission === "available") && !exhausted;
    return {
      status: 200,
      body: {
        available,
        provider: this.provider.id ?? null,
        quotaScope: this.evaluation || this.renderPolicyId ? "shared" : "user",
        ...quota,
        fallback: exhausted ? config.fallback : null,
        unavailableReason: exhausted
          ? "quota_exhausted"
          : available ? null : "provider_unconfigured",
      },
    };
  }

  async submit(userId: string, request: JudgeSubmissionRequest): Promise<ServiceResponse> {
    await this.checkEvaluationQuota(userId, request.problemId);
    const config = await this.repository.getConfig(request.problemId);
    if (!config) return errorResponse("PROBLEM_NOT_FOUND", "Problem not found.");

    const unsafeReason = validateJavaSource(request.sourceCode);
    if (unsafeReason) return errorResponse("UNSAFE_SOURCE", unsafeReason);

    const program = buildJavaProgram(request.sourceCode,
      config.publicCasePlan ? framedHarness(config.harnessSource) : config.harnessSource);
    if (Buffer.byteLength(program, "utf8") > 65_536) {
      return errorResponse("INVALID_REQUEST", "The solution and judge harness are too large to execute safely.");
    }

    this.assertAdmission(userId, request.problemId);
    const period = this.evaluation?.period ?? quotaPeriod(this.now());
    if (!this.provider.configured || (this.provider.provenance && !this.renderPolicyId)) {
      const { admission: _admission, ...quota } = await this.repository.getQuota(period, this.quotaLimit, this.renderPolicyId);
      return errorResponse(
        "JUDGE_UNAVAILABLE",
        "In-app execution is not configured. No external sandbox request was made.",
        quota,
      );
    }

    const action = request.action ?? "run";
    let participants: SubmissionParticipants | null = null;
    if (action === "submit") {
      const hasExisting = () => this.repository.hasSubmissionKey(userId, request.idempotencyKey);
      if (!await hasExisting()) {
        if (!this.captureParticipants) return errorResponse("JUDGE_UNAVAILABLE", "Room participation could not be verified. No execution was started.");
        try {
          const snapshot = await this.captureParticipants(request.roomId);
          participants = this.evaluation ? { ...snapshot, roomId: null, userIds: [userId] } : snapshot;
        } catch (error) {
          if (!await hasExisting()) throw error;
        }
      }
    }
    this.assertAdmission(userId, request.problemId);
    const reservation = await this.repository.reserve({
      userId,
      problemId: request.problemId,
      idempotencyKey: request.idempotencyKey,
      sourceCode: request.sourceCode,
      action,
      participants,
      period,
      quotaLimit: this.quotaLimit,
      activeLimit: this.activeLimit,
      reservationSeconds: this.reservationSeconds,
      ...(this.provider.id === "onlinecompiler" ? { runner: "onlinecompiler" as const } : {}),
      ...(this.provider.provenance && this.renderPolicyId ? { render: {
        policyId: this.renderPolicyId, provenance: this.provider.provenance,
      } } : {}),
    });

    if (reservation.result === "problem_not_found") {
      return errorResponse("PROBLEM_NOT_FOUND", "Problem not found.");
    }
    if (reservation.result === "exhausted") {
      return {
        status: 429,
        body: {
          ok: false,
          error: { code: "QUOTA_EXHAUSTED", message: this.provider.provenance || this.evaluation
            ? "The shared execution allowance is exhausted."
            : "Your execution allowance or the external sandbox's account allowance is exhausted." },
          quota: reservation.quota,
          fallback: config.fallback,
        },
      };
    }
    if (reservation.result === "busy" || reservation.result === "in_progress") {
      return errorResponse(
        "BUSY",
        reservation.result === "in_progress"
          ? "This submission is already being judged."
          : "The judge is at its concurrency limit. Try again shortly.",
        reservation.quota,
      );
    }
    if (reservation.result === "existing") {
      const existing = await this.repository.getSubmission(userId, reservation.submissionId);
      if (!existing) return errorResponse("JUDGE_UNAVAILABLE", "The saved submission could not be loaded.", reservation.quota);
      return failedExisting(existing, reservation.quota, request.sourceCode);
    }

    try {
      if (this.provider.provenance && !reservation.attempt) throw new Error("Durable Render attempt required.");
      this.assertAdmission(userId, request.problemId);
      const execution = await this.provider.execute(program, reservation.attempt);
      const completionBase = {
        userId,
        submissionId: reservation.submissionId,
        testsTotal: config.expectedOutput.length,
        durationMs: execution.durationMs,
        providerCpuTime: execution.cpuTime,
        providerMemory: execution.memory,
      };

      let completion: JudgeCompletion;
      let compiler: CompilerReport | undefined;
      let observed: string[] | undefined;
      if (execution.kind === "execution_error") {
        if (execution.verdict === "compile_error") compiler = publicCompilerReport(
          request.sourceCode, execution.diagnostics, execution.compilerDiagnostics,
          execution.compilerErrorCount, execution.compilerDiagnosticsComplete,
        );
        completion = {
          ...completionBase,
          judgeState: "completed",
          verdict: execution.verdict,
          testsPassed: 0,
          diagnostics: compiler ? compilerSummary(compiler.compilerDiagnostics) : publicExecutionDiagnostics(execution.verdict, request.sourceCode, null),
        };
      } else {
        let comparison: { verdict: JudgeVerdict; passed: number };
        if (config.publicCasePlan) {
          const outputs = readCaseOutputs(execution.output, config.expectedOutput.length);
          if (!outputs) throw new ProviderFailure("unavailable", "The sandbox did not return complete structured fixture results.");
          observed = outputs;
          const passed = outputs.reduce((count, output, index) => count + Number(casePassed(output, config.expectedOutput[index])), 0);
          comparison = { passed, verdict: passed === config.expectedOutput.length ? "accepted" : "wrong_answer" };
        } else {
          comparison = compareOutput(execution.output, config.expectedOutput);
        }
        completion = {
          ...completionBase,
          judgeState: "completed",
          verdict: comparison.verdict,
          testsPassed: comparison.passed,
          diagnostics: comparison.verdict === "accepted"
            ? "All LeetCollab fixture checks passed."
            : `${comparison.passed} of ${config.expectedOutput.length} LeetCollab fixture checks passed.`,
        };
      }

      const completed = await this.repository.complete(completion);
      if (!completed.applied) return failedExisting(completed.submission, completed.quota, request.sourceCode);
      if (participants?.roomId && completed.submission.verdict === "accepted") {
        // Notification is a refresh hint after durable credit, never authority to
        // grant a solve. A failed hint cannot turn success into a charged retry.
        try { await this.notifyCompletion?.(completed.submission.id); } catch { /* Refresh/reconnect reads durable credit. */ }
      }
      return { status: 200, body: { ok: true,
        submission: publicSubmission(completed.submission, request.sourceCode, compiler, publicCaseResults(config, observed)),
        quota: completed.quota } };
    } catch (error) {
      const failure = error instanceof ProviderFailure
        ? error
        : new ProviderFailure("unavailable", "The external sandbox request failed.");
      let quota = reservation.quota;
      try {
        const completed = await this.repository.complete({
          userId,
          submissionId: reservation.submissionId,
          judgeState: "failed",
          verdict: "runtime_error",
          testsPassed: 0,
          testsTotal: config.expectedOutput.length,
          durationMs: 0,
          diagnostics: failure.message,
          providerCpuTime: null,
          providerMemory: null,
        });
        quota = completed.quota;
        if (!completed.applied && failure.kind !== "quota_exhausted") {
          return failedExisting(completed.submission, quota, request.sourceCode);
        }
      } catch {
        // JDoodle leases expire. Render retains active capacity until durable cleanup evidence or operator reconciliation.
      }

      if (failure.kind === "quota_exhausted" && !this.provider.provenance) {
        try {
          quota = await this.repository.exhaust(period.start);
        } catch {
          // Keep the last known quota. The operator still receives an unavailable response.
        }
        return {
          status: 429,
          body: {
            ok: false,
            error: { code: "QUOTA_EXHAUSTED", message: "The external sandbox reports that its shared quota is exhausted." },
            quota,
            fallback: config.fallback,
          },
        };
      }

      return errorResponse(
        "JUDGE_UNAVAILABLE",
        "The external sandbox could not complete this attempt. The quota reservation was retained because the provider may have counted the request.",
        quota,
      );
    }
  }
}

export { compareOutput, quotaPeriod, withRemaining };
