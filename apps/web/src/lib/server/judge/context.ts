import { getSupabaseAdmin } from "../supabase-admin";
import { assertEvaluationAdmission, readJudgeEvaluation } from "./evaluation";
import { JdoodleProvider } from "./jdoodle";
import { OnlineCompilerProvider } from "./onlinecompiler";
import { JudgeService } from "./service";
import { SupabaseJudgeRepository } from "./supabase-repository";
import { ProviderFailure, type ExecutionProvider } from "./types";

function integerEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function getJudgeService(userId?: string, problemId?: string): JudgeService {
  const evaluation = readJudgeEvaluation();
  const beforeRequest = () => assertEvaluationAdmission(evaluation, userId, problemId);
  // Refuse before constructing a provider or a quota-mutating repository path.
  beforeRequest();
  return new JudgeService(
    new SupabaseJudgeRepository(getSupabaseAdmin()),
    getExecutionProvider(beforeRequest),
    {
      evaluation,
      quotaLimit: integerEnvironment("JUDGE_DAILY_LIMIT", 20),
      activeLimit: integerEnvironment("JUDGE_MAX_CONCURRENCY", 4),
      reservationSeconds: integerEnvironment("JUDGE_RESERVATION_SECONDS", 45),
    },
  );
}

// Selection is server-owned. A refusal never falls back to a second provider.
export function getExecutionProvider(beforeRequest?: () => void): ExecutionProvider {
  switch (process.env.JUDGE_PROVIDER ?? "jdoodle") {
    case "jdoodle": return JdoodleProvider.fromEnvironment();
    case "onlinecompiler": return OnlineCompilerProvider.fromEnvironment(beforeRequest);
    default: return {
      configured: false,
      async execute() { throw new ProviderFailure("unavailable", "Execution provider is disabled."); },
    };
  }
}
