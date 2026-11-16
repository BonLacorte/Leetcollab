import { judgeSubmissionRequestSchema } from "@leetcollab/contracts";
import { ProviderFailure, type QuotaPeriod } from "./types";

export type JudgeEvaluation = Readonly<{
  userId: string;
  problemId: string;
  period: QuotaPeriod;
  startsAt: number;
  expiresAt: number;
  baselineUsed: number;
  quotaLimit: number;
}>;

function deny(): never {
  throw new ProviderFailure("unavailable", "Judge evaluation is unavailable.");
}

function utc(name: string): number {
  const value = process.env[name] ?? "";
  // Require an unambiguous UTC instant and reject normalized impossible dates.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) deny();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z")) deny();
  return time;
}

function integer(name: string): number {
  const value = process.env[name] ?? "";
  if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) deny();
  return Number(value);
}

/** A selected evaluation never inherits normal-mode defaults. */
export function readJudgeEvaluation(): JudgeEvaluation | undefined {
  const mode = process.env.JUDGE_ACCESS_MODE;
  if (mode === undefined || mode === "normal") return undefined;
  if (mode !== "evaluation" || process.env.JUDGE_PROVIDER !== "onlinecompiler") deny();
  const user = judgeSubmissionRequestSchema.shape.problemId.safeParse(process.env.JUDGE_EVALUATION_USER_ID);
  const problem = judgeSubmissionRequestSchema.shape.problemId.safeParse(process.env.JUDGE_EVALUATION_PROBLEM_ID);
  if (!user.success || !problem.success) deny();
  const periodStart = utc("JUDGE_EVALUATION_PERIOD_START");
  const period = new Date(periodStart);
  if (period.getUTCHours() !== 23 || period.getUTCMinutes() !== 55
    || period.getUTCSeconds() !== 0 || period.getUTCMilliseconds() !== 0) deny();
  const periodEnd = periodStart + 86_400_000;
  const startsAt = utc("JUDGE_EVALUATION_STARTS_AT");
  const expiresAt = utc("JUDGE_EVALUATION_EXPIRES_AT");
  if (startsAt < periodStart || expiresAt <= startsAt || expiresAt - startsAt > 600_000
    || expiresAt > periodEnd - 120_000) deny();
  const baselineUsed = integer("JUDGE_EVALUATION_BASELINE_USED");
  const quotaLimit = integer("JUDGE_DAILY_LIMIT");
  if (baselineUsed > 18 || quotaLimit !== baselineUsed + 2 || quotaLimit > 20
    || integer("JUDGE_MAX_CONCURRENCY") !== 1
    || integer("JUDGE_RESERVATION_SECONDS") !== 45
    || integer("JUDGE_REQUEST_TIMEOUT_MS") !== 15_000) deny();
  return {
    userId: user.data.toLowerCase(), problemId: problem.data.toLowerCase(),
    period: { start: period.toISOString(), end: new Date(periodEnd).toISOString() },
    startsAt, expiresAt, baselineUsed, quotaLimit,
  };
}

export function assertEvaluationAdmission(
  evaluation: JudgeEvaluation | undefined, userId: string | undefined, problemId: string | undefined,
  now = new Date(),
): void {
  if (!evaluation) return;
  const time = now.getTime();
  if (userId?.toLowerCase() !== evaluation.userId || problemId?.toLowerCase() !== evaluation.problemId
    || !Number.isFinite(time) || time < evaluation.startsAt || time >= evaluation.expiresAt
    || time < Date.parse(evaluation.period.start) || time >= Date.parse(evaluation.period.end)) deny();
}
