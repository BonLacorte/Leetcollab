import type {
  JudgeErrorCode,
  JudgeQuota,
  JudgeStatusResponse,
  JudgeSubmissionRequest,
  JudgeSubmissionResponse,
  JudgeVerdict,
} from "@leetcollab/contracts";
import { buildJavaProgram, validateJavaSource } from "./safety";
import {
  ProviderFailure,
  type ExecutionProvider,
  type JudgeCompletion,
  type JudgeRepository,
  type QuotaPeriod,
  type StoredSubmission,
} from "./types";

type ServiceResponse = { status: number; body: JudgeSubmissionResponse };

export type JudgeServiceOptions = {
  quotaLimit?: number;
  activeLimit?: number;
  reservationSeconds?: number;
  now?: () => Date;
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

function failedExisting(submission: StoredSubmission, quota: JudgeQuota): ServiceResponse {
  if (submission.judgeState === "failed") {
    return errorResponse(
      "JUDGE_UNAVAILABLE",
      "This attempt could not be completed by the external sandbox. Use a new submission key to try again.",
      quota,
    );
  }
  return { status: 200, body: { ok: true, submission, quota } };
}

export class JudgeService {
  private readonly quotaLimit: number;
  private readonly activeLimit: number;
  private readonly reservationSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: JudgeRepository,
    private readonly provider: ExecutionProvider,
    options: JudgeServiceOptions = {},
  ) {
    this.quotaLimit = Math.min(20, Math.max(1, options.quotaLimit ?? 20));
    this.activeLimit = Math.max(1, options.activeLimit ?? 4);
    this.reservationSeconds = Math.min(120, Math.max(5, options.reservationSeconds ?? 45));
    this.now = options.now ?? (() => new Date());
  }

  async status(problemId: string): Promise<{ status: number; body: JudgeStatusResponse | { error: { code: JudgeErrorCode; message: string } } }> {
    const config = await this.repository.getConfig(problemId);
    if (!config) {
      return { status: 404, body: { error: { code: "PROBLEM_NOT_FOUND", message: "Problem not found." } } };
    }

    const period = quotaPeriod(this.now());
    const quota = await this.repository.getQuota(period, this.quotaLimit);
    const exhausted = quota.remaining === 0;
    const available = this.provider.configured && !exhausted;
    return {
      status: 200,
      body: {
        available,
        ...quota,
        fallback: exhausted ? config.fallback : null,
        unavailableReason: exhausted
          ? "quota_exhausted"
          : this.provider.configured ? null : "provider_unconfigured",
      },
    };
  }

  async submit(userId: string, request: JudgeSubmissionRequest): Promise<ServiceResponse> {
    const config = await this.repository.getConfig(request.problemId);
    if (!config) return errorResponse("PROBLEM_NOT_FOUND", "Problem not found.");

    const unsafeReason = validateJavaSource(request.sourceCode);
    if (unsafeReason) return errorResponse("UNSAFE_SOURCE", unsafeReason);

    const program = buildJavaProgram(request.sourceCode, config.harnessSource);
    if (Buffer.byteLength(program, "utf8") > 65_536) {
      return errorResponse("INVALID_REQUEST", "The solution and judge harness are too large to execute safely.");
    }

    const period = quotaPeriod(this.now());
    if (!this.provider.configured) {
      const quota = await this.repository.getQuota(period, this.quotaLimit);
      return errorResponse(
        "JUDGE_UNAVAILABLE",
        "In-app execution is not configured. No external sandbox request was made.",
        quota,
      );
    }

    const reservation = await this.repository.reserve({
      userId,
      problemId: request.problemId,
      idempotencyKey: request.idempotencyKey,
      sourceCode: request.sourceCode,
      period,
      quotaLimit: this.quotaLimit,
      activeLimit: this.activeLimit,
      reservationSeconds: this.reservationSeconds,
    });

    if (reservation.result === "problem_not_found") {
      return errorResponse("PROBLEM_NOT_FOUND", "Problem not found.");
    }
    if (reservation.result === "exhausted") {
      return {
        status: 429,
        body: {
          ok: false,
          error: { code: "QUOTA_EXHAUSTED", message: "The shared daily execution quota is exhausted." },
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
      return failedExisting(existing, reservation.quota);
    }

    try {
      const execution = await this.provider.execute(program);
      const completionBase = {
        userId,
        submissionId: reservation.submissionId,
        testsTotal: config.expectedOutput.length,
        durationMs: execution.durationMs,
        providerCpuTime: execution.cpuTime,
        providerMemory: execution.memory,
      };

      let completion: JudgeCompletion;
      if (execution.kind === "execution_error") {
        completion = {
          ...completionBase,
          judgeState: "completed",
          verdict: execution.verdict,
          testsPassed: 0,
          diagnostics: execution.diagnostics,
        };
      } else {
        const comparison = compareOutput(execution.output, config.expectedOutput);
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
      return { status: 200, body: { ok: true, submission: completed.submission, quota: completed.quota } };
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
      } catch {
        // The database lease expires and releases active capacity if completion cannot be recorded.
      }

      if (failure.kind === "quota_exhausted") {
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
