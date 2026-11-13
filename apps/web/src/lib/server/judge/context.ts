import { getSupabaseAdmin } from "../supabase-admin";
import { JdoodleProvider } from "./jdoodle";
import { JudgeService } from "./service";
import { SupabaseJudgeRepository } from "./supabase-repository";

function integerEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function getJudgeService(): JudgeService {
  return new JudgeService(
    new SupabaseJudgeRepository(getSupabaseAdmin()),
    JdoodleProvider.fromEnvironment(),
    {
      quotaLimit: integerEnvironment("JUDGE_DAILY_LIMIT", 20),
      activeLimit: integerEnvironment("JUDGE_MAX_CONCURRENCY", 4),
      reservationSeconds: integerEnvironment("JUDGE_RESERVATION_SECONDS", 45),
    },
  );
}
