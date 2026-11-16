import { afterEach, expect, it, vi } from "vitest";

vi.mock("../supabase-admin", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("./supabase-repository", () => ({
  SupabaseJudgeRepository: class {
    async getConfig() { return { fallback: null }; }
    async getQuota() { return { used: 0, remaining: 20, active: 0, limit: 20, resetAt: "2026-11-15T23:55:00Z" }; }
  },
}));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("keeps production status unconfigured when only Render flags and identities are present", async () => {
  // Oracle: offline preparation must not change the application's provider selection.
  for (const name of ["JDOODLE_CLIENT_ID", "JDOODLE_CLIENT_SECRET", "JDOODLE_JAVA_VERSION_INDEX", "JDOODLE_LIMITS_CONFIRMED"])
    vi.stubEnv(name, undefined);
  vi.stubEnv("RENDER_ENABLED", "true");
  vi.stubEnv("RENDER_ACTIVATED", "true");
  vi.stubEnv("RENDER_API_KEY", "mock-not-a-key");
  vi.stubEnv("RENDER_WORKSPACE_ID", "tea-csprhmi3esus73alsv70");
  vi.stubEnv("RENDER_SANDBOX_GROUP_ID", "sbg-cph1rs3idesc73a2b2mg");
  vi.stubEnv("RENDER_IMAGE_ID", "sbb-cph1rs3idesc73a2b2mg");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  await expect(getJudgeService().status("problem")).resolves.toMatchObject({
    body: { available: false, unavailableReason: "provider_unconfigured", used: 0 },
  });
  expect(network).not.toHaveBeenCalled();
});

function configuredLegacy() {
  vi.stubEnv("JDOODLE_CLIENT_ID", "synthetic-id");
  vi.stubEnv("JDOODLE_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("JDOODLE_JAVA_VERSION_INDEX", "5");
  vi.stubEnv("JDOODLE_LIMITS_CONFIRMED", "true");
}

it.each(["disabled", "render", "unknown-provider"])("refuses unsupported or disabled selection %s without fallback", async selected => {
  configuredLegacy();
  vi.stubEnv("JUDGE_PROVIDER", selected);
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  await expect(getJudgeService().status("problem")).resolves.toMatchObject({
    body: { available: false, unavailableReason: "provider_unconfigured" },
  });
  expect(network).not.toHaveBeenCalled();
});

it("does not fall back to configured JDoodle when selected OnlineCompiler lacks approval", async () => {
  configuredLegacy();
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("ONLINECOMPILER_API_KEY", "synthetic-rest-key");
  vi.stubEnv("ONLINECOMPILER_LIMITS_CONFIRMED", "false");
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "true");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService, getExecutionProvider } = await import("./context");
  expect(getExecutionProvider().id).toBe("onlinecompiler");
  await expect(getJudgeService().status("problem")).resolves.toMatchObject({
    body: { available: false, unavailableReason: "provider_unconfigured" },
  });
  expect(network).not.toHaveBeenCalled();
});

it("selects approved OnlineCompiler on the server without exposing its key or making a status execution", async () => {
  vi.stubEnv("JUDGE_PROVIDER", "onlinecompiler");
  vi.stubEnv("ONLINECOMPILER_API_KEY", "synthetic-rest-key");
  vi.stubEnv("ONLINECOMPILER_LIMITS_CONFIRMED", "true");
  vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", "true");
  const network = vi.fn(() => { throw new Error("Network forbidden"); });
  vi.stubGlobal("fetch", network);
  const { getJudgeService } = await import("./context");
  const result = await getJudgeService().status("problem");
  expect(result.body).toMatchObject({ available: true, unavailableReason: null });
  expect(JSON.stringify(result.body)).not.toContain("synthetic-rest-key");
  expect(network).not.toHaveBeenCalled();
});

it("preserves explicit JDoodle rollback and legacy deployments without a selector", async () => {
  configuredLegacy();
  const { getJudgeService } = await import("./context");
  for (const selected of [undefined, "jdoodle"]) {
    vi.stubEnv("JUDGE_PROVIDER", selected);
    await expect(getJudgeService().status("problem")).resolves.toMatchObject({ body: { available: true } });
  }
});
