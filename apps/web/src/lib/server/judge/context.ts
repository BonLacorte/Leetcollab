import { getSupabaseAdmin } from "../supabase-admin";
import { assertEvaluationAdmission, readJudgeEvaluation } from "./evaluation";
import { JdoodleProvider } from "./jdoodle";
import { OnlineCompilerProvider } from "./onlinecompiler";
import { JudgeService } from "./service";
import { SupabaseJudgeRepository } from "./supabase-repository";
import { ProviderFailure, type ExecutionProvider } from "./types";
import { captureSubmissionParticipants, notifyRoomCompletion } from "./room-participants";

function integerEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function localTestingEnabled(): boolean {
  if (process.env.NODE_ENV !== "development" || process.env.JUDGE_LOCAL_TESTING !== "true"
    || process.env.JUDGE_PROVIDER !== "onlinecompiler"
    || ![undefined, "normal"].includes(process.env.JUDGE_ACCESS_MODE)) return false;
  try {
    const url = new URL(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function getJudgeService(userId?: string, problemId?: string, accessToken?: string): JudgeService {
  const evaluation = readJudgeEvaluation();
  const beforeRequest = () => assertEvaluationAdmission(evaluation, userId, problemId);
  // Refuse before constructing a provider or a quota-mutating repository path.
  beforeRequest();
  return new JudgeService(
    new SupabaseJudgeRepository(getSupabaseAdmin(), { userId, sharedQuota: Boolean(evaluation) }),
    getExecutionProvider(beforeRequest),
    {
      evaluation,
      localTesting: localTestingEnabled(),
      quotaLimit: integerEnvironment("JUDGE_DAILY_LIMIT", 25),
      ...(!evaluation && accessToken && userId ? { captureParticipants: (roomId?: string) => captureSubmissionParticipants(accessToken, userId, problemId!, roomId) } : {}),
      ...(!evaluation && accessToken ? { notifyCompletion: (id: string) => notifyRoomCompletion(accessToken, id) } : {}),
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
