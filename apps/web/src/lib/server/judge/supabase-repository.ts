import type { SupabaseClient } from "@supabase/supabase-js";
import type { JudgeQuota, JudgeVerdict } from "@leetcollab/contracts";
import { withRemaining } from "./service";
import { readPublicCasePlan } from "./public-cases";
import type {
  JudgeCompletion,
  JudgeConfig,
  JudgeRepository,
  QuotaPeriod,
  Reservation,
  StoredSubmission,
  ExecutionAttempt,
  AdmissionQuota,
} from "./types";

type RpcQuota = {
  used: number;
  limit: number;
  active: number;
  resetAt: string;
  admission?: AdmissionQuota["admission"];
};

function quota(value: RpcQuota): JudgeQuota {
  return withRemaining({
    used: Number(value.used),
    limit: Number(value.limit),
    active: Number(value.active),
    resetAt: new Date(value.resetAt).toISOString(),
  });
}

function submission(row: Record<string, unknown>): StoredSubmission {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    language: "java",
    verdict: String(row.verdict) as JudgeVerdict,
    verification: "leetcollab",
    testsPassed: Number(row.tests_passed),
    testsTotal: Number(row.tests_total),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    diagnostics: row.diagnostics === null ? null : String(row.diagnostics),
    createdAt: new Date(String(row.created_at)).toISOString(),
    judgeState: String(row.judge_state) as StoredSubmission["judgeState"],
  };
}

const submissionColumns = "id, problem_id, verdict, tests_passed, tests_total, duration_ms, diagnostics, created_at, judge_state";

export class SupabaseJudgeRepository implements JudgeRepository {
  constructor(private readonly client: SupabaseClient, private readonly options: { userId?: string; sharedQuota?: boolean } = {}) {}

  async getConfig(problemId: string): Promise<JudgeConfig | null> {
    const { data, error } = await this.client
      .from("problem_judge_configs")
      .select("problem_id, fixture_version, harness_source, expected_output, public_case_plan, source_judge_name, source_judge_url, problems!inner(is_enabled)")
      .eq("problems.is_enabled", true)
      .eq("problem_id", problemId)
      .maybeSingle();
    if (error) throw error;
    if (!data || !Array.isArray(data.expected_output) || !data.expected_output.every((value) => typeof value === "string")) {
      return null;
    }
    return {
      problemId: data.problem_id,
      fixtureVersion: data.fixture_version,
      harnessSource: data.harness_source,
      expectedOutput: data.expected_output,
      publicCasePlan: readPublicCasePlan(data.public_case_plan, data.fixture_version, data.harness_source, data.expected_output),
      fallback: data.source_judge_name && data.source_judge_url
        ? { name: data.source_judge_name, url: data.source_judge_url, verification: "external_self_reported" }
        : null,
    };
  }

  async readQuota(period: QuotaPeriod): Promise<JudgeQuota | null> {
    const { data, error } = await this.client.from("judge_quota_periods")
      .select("used, quota_limit, active, period_end")
      .eq("period_start", period.start).maybeSingle();
    if (error) throw error;
    return data ? quota({ used: data.used, limit: data.quota_limit,
      active: data.active, resetAt: data.period_end }) : null;
  }

  async getQuota(period: QuotaPeriod, limit: number, renderPolicyId?: string): Promise<AdmissionQuota> {
    if (renderPolicyId) {
      const { data, error } = await this.client.rpc("get_render_quota_status", { p_policy_id: renderPolicyId });
      if (error) throw error;
      return { ...quota(data as RpcQuota), admission: (data as RpcQuota).admission };
    }
    const personal = this.options.userId && !this.options.sharedQuota;
    const { data, error } = await this.client.rpc(personal ? "get_user_judge_quota_status" : "get_judge_quota_status", {
      ...(personal ? { p_user_id: this.options.userId } : {}),
      p_period_start: period.start,
      p_period_end: period.end,
      p_quota_limit: limit,
    });
    if (error) throw error;
    return { ...quota(data as RpcQuota), admission: (data as RpcQuota).admission };
  }

  async reserve(input: Parameters<JudgeRepository["reserve"]>[0]): Promise<Reservation> {
    if (input.runner && (input.runner !== "onlinecompiler" || input.render)) {
      throw new Error("Invalid server-owned judge runner selection.");
    }
    if (input.render) return this.reserveRender(input);
    const contextual = Boolean(this.options.userId);
    const { data, error } = await this.client.rpc(contextual ? "reserve_judge_execution" : input.runner === "onlinecompiler"
      ? "reserve_onlinecompiler_submission" : "reserve_judge_submission", {
      ...(contextual ? {
        p_scope: this.options.sharedQuota ? "shared" : "user",
        p_runner: input.runner ?? "jdoodle", p_action: input.action ?? "run",
        p_room_id: input.participants?.roomId ?? null,
        p_participant_ids: input.participants?.userIds ?? null,
      } : {}),
      p_user_id: input.userId,
      p_problem_id: input.problemId,
      p_idempotency_key: input.idempotencyKey,
      p_language: "java",
      p_source_code: input.sourceCode,
      p_period_start: input.period.start,
      p_period_end: input.period.end,
      p_quota_limit: input.quotaLimit,
      p_active_limit: input.activeLimit,
      p_reservation_seconds: input.reservationSeconds,
    });
    if (error) throw error;
    const result = data as RpcQuota & { result: Reservation["result"]; submissionId?: string };
    const resultQuota = result.limit
      ? quota(result)
      : withRemaining({ used: 0, limit: input.quotaLimit, active: 0, resetAt: input.period.end });
    if (result.result === "reserved" || result.result === "existing" || result.result === "in_progress") {
      if (!result.submissionId) throw new Error("Judge reservation did not return a submission ID.");
      return { result: result.result, submissionId: result.submissionId, quota: resultQuota };
    }
    return { result: result.result, quota: resultQuota };
  }

  private async reserveRender(input: Parameters<JudgeRepository["reserve"]>[0]): Promise<Reservation> {
    const { policyId, provenance } = input.render!;
    const { data, error } = await this.client.rpc("reserve_render_submission", {
      p_user_id: input.userId, p_problem_id: input.problemId,
      p_idempotency_key: input.idempotencyKey, p_source_code: input.sourceCode,
      p_policy_id: policyId, p_provenance: provenance,
    });
    if (error) throw error;
    const result = data as RpcQuota & { result: Reservation["result"]; submissionId?: string };
    const resultQuota = quota(result);
    if (result.result === "reserved" || result.result === "existing" || result.result === "in_progress") {
      if (!result.submissionId) throw new Error("Missing durable Render attempt identity.");
      const id = result.submissionId;
      const transition = async (phase: string, resourceId: string | null = null) => {
        const { error } = await this.client.rpc("record_render_attempt", {
          p_user_id: input.userId, p_submission_id: id, p_phase: phase, p_resource_id: resourceId,
        });
        if (error) throw error;
      };
      const attempt: ExecutionAttempt = {
        id, begin: () => transition("creating"),
        acknowledge: (resourceId) => transition("acknowledged", resourceId),
        cleanupAcknowledged: (resourceId) => transition("settled", resourceId),
      };
      return result.result === "reserved"
        ? { result: "reserved", submissionId: id, quota: resultQuota, attempt }
        : { result: result.result, submissionId: id, quota: resultQuota };
    }
    if (!["busy", "exhausted", "problem_not_found"].includes(result.result)) {
      throw new Error("Invalid Render admission response.");
    }
    return { result: result.result, quota: resultQuota };
  }

  async hasSubmissionKey(userId: string, key: string): Promise<boolean> {
    const { data, error } = await this.client.from("submissions").select("id")
      .eq("user_id", userId).eq("idempotency_key", key).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }

  async getSubmission(userId: string, submissionId: string): Promise<StoredSubmission | null> {
    const { data, error } = await this.client
      .from("submissions")
      .select(submissionColumns)
      .eq("id", submissionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? submission(data) : null;
  }

  async complete(completion: JudgeCompletion): Promise<{ submission: StoredSubmission; quota: JudgeQuota; applied: boolean }> {
    const { data, error } = await this.client.rpc("complete_judge_submission", {
      p_user_id: completion.userId,
      p_submission_id: completion.submissionId,
      p_judge_state: completion.judgeState,
      p_verdict: completion.verdict,
      p_tests_passed: completion.testsPassed,
      p_tests_total: completion.testsTotal,
      p_duration_ms: completion.durationMs,
      p_diagnostics: completion.diagnostics,
      p_provider_cpu_time: completion.providerCpuTime,
      p_provider_memory: completion.providerMemory,
    });
    if (error) throw error;
    const stored = await this.getSubmission(completion.userId, completion.submissionId);
    if (!stored) throw new Error("Completed submission could not be loaded.");
    const result = data as RpcQuota & { result?: string };
    return { submission: stored, quota: quota(result), applied: result.result === "completed" };
  }

  async exhaust(period: QuotaPeriod, limit: number): Promise<JudgeQuota> {
    const { data, error } = await this.client.rpc("exhaust_judge_quota", { p_period_start: period.start });
    if (error) throw error;
    if (this.options.userId && !this.options.sharedQuota) {
      const { admission: _admission, ...personal } = await this.getQuota(period, limit);
      return personal;
    }
    return quota(data as RpcQuota);
  }
}
