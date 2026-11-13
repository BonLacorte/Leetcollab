import type {
  JudgeFallback,
  JudgeQuota,
  JudgeSubmission,
  JudgeVerdict,
} from "@leetcollab/contracts";

export type QuotaPeriod = {
  start: string;
  end: string;
};

export type JudgeConfig = {
  problemId: string;
  fixtureVersion: number;
  harnessSource: string;
  expectedOutput: string[];
  fallback: JudgeFallback;
};

export type StoredSubmission = JudgeSubmission & {
  judgeState: "reserved" | "completed" | "failed";
};

export type Reservation =
  | { result: "reserved"; submissionId: string; quota: JudgeQuota }
  | { result: "existing"; submissionId: string; quota: JudgeQuota }
  | { result: "in_progress"; submissionId: string; quota: JudgeQuota }
  | { result: "exhausted"; quota: JudgeQuota }
  | { result: "busy"; quota: JudgeQuota }
  | { result: "problem_not_found"; quota: JudgeQuota };

export type JudgeCompletion = {
  userId: string;
  submissionId: string;
  judgeState: "completed" | "failed";
  verdict: JudgeVerdict;
  testsPassed: number;
  testsTotal: number;
  durationMs: number;
  diagnostics: string;
  providerCpuTime: string | null;
  providerMemory: string | null;
};

export interface JudgeRepository {
  getConfig(problemId: string): Promise<JudgeConfig | null>;
  getQuota(period: QuotaPeriod, limit: number): Promise<JudgeQuota>;
  reserve(input: {
    userId: string;
    problemId: string;
    idempotencyKey: string;
    sourceCode: string;
    period: QuotaPeriod;
    quotaLimit: number;
    activeLimit: number;
    reservationSeconds: number;
  }): Promise<Reservation>;
  getSubmission(userId: string, submissionId: string): Promise<StoredSubmission | null>;
  complete(completion: JudgeCompletion): Promise<{ submission: StoredSubmission; quota: JudgeQuota }>;
  exhaust(periodStart: string): Promise<JudgeQuota>;
}

export type ExecutionResult =
  | {
      kind: "completed";
      output: string;
      durationMs: number;
      cpuTime: string | null;
      memory: string | null;
    }
  | {
      kind: "execution_error";
      verdict: Exclude<JudgeVerdict, "accepted" | "wrong_answer">;
      diagnostics: string;
      durationMs: number;
      cpuTime: string | null;
      memory: string | null;
    };

export interface ExecutionProvider {
  readonly configured: boolean;
  execute(source: string): Promise<ExecutionResult>;
}

export class ProviderFailure extends Error {
  constructor(
    readonly kind: "unavailable" | "quota_exhausted",
    message: string,
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}
