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
