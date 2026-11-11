import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), submit: vi.fn(), status: vi.fn() }));
vi.mock("../../../lib/server/supabase-admin", () => ({ getSupabaseAdmin: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("../../../lib/server/judge/context", () => ({ getJudgeService: () => ({ submit: mocks.submit, status: mocks.status }) }));
import { POST } from "./submissions/route";
import { GET } from "./status/route";
const payload = { problemId: "11111111-1111-4111-8111-111111111111", language: "java", sourceCode: "class Solution {}", idempotencyKey: "22222222-2222-4222-8222-222222222222" };
function request(body: unknown = payload, token = "valid") {
  return new Request("https://app.test/api/judge/submissions", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null }); });
describe("authenticated judge HTTP boundary", () => {
  it("rejects absent and rejected sessions before judging", async () => {
    expect((await POST(new Request("https://app.test", { method: "POST" }))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("rejects unsupported languages", async () => {
    expect((await POST(request({ ...payload, language: "javascript" }))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("uses the validated user rather than caller-supplied ownership", async () => {
    mocks.submit.mockResolvedValue({ status: 429, body: { ok: false, error: { code: "QUOTA_EXHAUSTED" }, fallback: null } });
    const response = await POST(request({ ...payload, userId: "victim" }));
    expect(mocks.submit).toHaveBeenCalledWith("owner", payload);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ fallback: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("requires auth and valid problem IDs for status", async () => {
    expect((await GET(new Request("https://app.test/api/judge/status"))).status).toBe(401);
    expect((await GET(new Request("https://app.test/api/judge/status?problemId=invalid", { headers: { authorization: "Bearer valid" } }))).status).toBe(400);
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
