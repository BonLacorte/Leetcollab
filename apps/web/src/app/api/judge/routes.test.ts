import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ compose: vi.fn(), getUser: vi.fn(), submit: vi.fn(), status: vi.fn() }));
vi.mock("../../../lib/server/supabase-admin", () => ({ getSupabaseAdmin: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("../../../lib/server/judge/context", () => ({ getJudgeService: (...args: unknown[]) => { mocks.compose(...args); return { submit: mocks.submit, status: mocks.status }; } }));
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
    const response = await POST(request({ ...payload, userId: "victim", verdict: "accepted",
      provenance: { provider: "render" }, quota: { used: 0 }, policyId: "forged", resolution: "gone" }));
    expect(mocks.compose).toHaveBeenCalledWith("owner", payload.problemId);
    expect(mocks.submit).toHaveBeenCalledWith("owner", payload);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ fallback: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("passes the verified identity to status admission and production composition", async () => {
    mocks.status.mockResolvedValue({ status: 200, body: { available: false } });
    expect((await GET(new Request(`https://app.test/api/judge/status?problemId=${payload.problemId}`, {
      headers: { authorization: "Bearer valid" },
    }))).status).toBe(200);
    expect(mocks.compose).toHaveBeenCalledWith("owner", payload.problemId);
    expect(mocks.status).toHaveBeenCalledWith(payload.problemId, "owner");
  });
  it("requires auth and valid problem IDs for status", async () => {
    expect((await GET(new Request("https://app.test/api/judge/status"))).status).toBe(401);
    expect((await GET(new Request("https://app.test/api/judge/status?problemId=invalid", { headers: { authorization: "Bearer valid" } }))).status).toBe(400);
    expect(mocks.status).not.toHaveBeenCalled();
  });
});

// Exercise the real HTTP route with streamed raw bytes; no Content-Length trust.
describe("bounded submission JSON ingress", () => {
  const max = 256 * 1024;
  const encoded = (text: string) => new TextEncoder().encode(text);
  function raw(parts: Uint8Array[], length?: string) {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { for (const part of parts) controller.enqueue(part); },
      pull(controller) { controller.close(); }, cancel,
    });
    const headers: Record<string, string> = { authorization: "Bearer valid" };
    if (length !== undefined) headers["content-length"] = length;
    const req = new Request("https://app.test/api/judge/submissions", {
      method: "POST", headers, body, duplex: "half",
    } as RequestInit);
    return { req, cancel };
  }
  beforeEach(() => mocks.submit.mockResolvedValue({ status: 200, body: { ok: true } }));

  it.each([undefined, "1", "262144"])("rejects oversized bytes with Content-Length %s", async (length) => {
    const { req, cancel } = raw([encoded('{"padding":"'), new Uint8Array(max).fill(32), encoded('"}')], length);
    const parse = vi.spyOn(JSON, "parse");
    expect((await POST(req)).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    // Ingress never parses the oversized transport envelope.
    expect(parse.mock.calls.some(([text]) => typeof text === "string" && text.startsWith('{"padding"'))).toBe(false);
    parse.mockRestore();
  });
  it.each(["999999", "-1", "bad"])("rejects a malformed/oversized declared length %s", async (length) => {
    const { req, cancel } = raw([encoded(JSON.stringify(payload))], length);
    expect((await POST(req)).status).toBe(400);
    expect(cancel).toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("accepts an exact byte boundary and split UTF-8 without a length header", async () => {
    const base = JSON.stringify({ ...payload, ignored: "é" });
    const bytes = encoded(base + " ".repeat(max - encoded(base).length));
    const split = bytes.indexOf(0xc3) + 1;
    const { req } = raw([bytes.slice(0, split), bytes.slice(split)]);
    expect((await POST(req)).status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith("owner", payload);
  });
  it("counts multibyte bytes, not JavaScript characters", async () => {
    const body = JSON.stringify({ ...payload, ignored: "é".repeat(max / 2) });
    expect(body.length).toBeLessThan(max);
    expect((await POST(raw([encoded(body)]).req)).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each([encoded('{"broken":'), new Uint8Array([0xff]), encoded("")])("rejects malformed JSON/UTF-8/empty bodies", async (bytes) => {
    expect((await POST(raw([bytes]).req)).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("authenticates before reading an oversized body", async () => {
    const { req } = raw([new Uint8Array(max + 1)]);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(req)).status).toBe(401);
    expect(req.bodyUsed).toBe(false);
  });
});
