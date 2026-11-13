import { describe, expect, it, vi } from "vitest";
import { JdoodleProvider } from "./jdoodle";

const configured = {
  limitsConfirmed: true,
  clientId: "server-id",
  clientSecret: "server-secret",
  javaVersionIndex: "operator-confirmed-index",
};

describe("JdoodleProvider", () => {
  it("sends only the pinned Java execution contract and parses bounded results", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        clientId: "server-id",
        clientSecret: "server-secret",
        script: "class Solution {}",
        language: "java",
        versionIndex: "operator-confirmed-index",
      });
      return new Response(JSON.stringify({ output: "42\n", isExecutionSuccess: true, cpuTime: "0.01", memory: "1234" }));
    });
    const result = await new JdoodleProvider({ ...configured, fetch: request as typeof fetch }).execute("class Solution {}");
    expect(result).toMatchObject({ kind: "completed", output: "42\n", cpuTime: "0.01", memory: "1234" });
  });

  it("maps provider quota rejection separately", async () => {
    const provider = new JdoodleProvider({
      ...configured,
      fetch: vi.fn(async () => new Response("", { status: 429 })) as typeof fetch,
    });
    await expect(provider.execute("class Solution {}"))
      .rejects.toMatchObject({ kind: "quota_exhausted" });
  });

  it("turns oversized program output into an output-limit verdict", async () => {
    const output = "x".repeat(16_385);
    const provider = new JdoodleProvider({
      ...configured,
      fetch: vi.fn(async () => new Response(JSON.stringify({ output, isExecutionSuccess: true }))) as typeof fetch,
    });
    await expect(provider.execute("class Solution {}"))
      .resolves.toMatchObject({ kind: "execution_error", verdict: "output_limit" });
  });

  it("does not call the network when credentials are absent", async () => {
    const request = vi.fn();
    const provider = new JdoodleProvider({ fetch: request as typeof fetch });
    expect(provider.configured).toBe(false);
    await expect(provider.execute("class Solution {}"))
      .rejects.toMatchObject({ kind: "unavailable" });
    expect(request).not.toHaveBeenCalled();
  });
});

it.each([{ statusCode: 401, error: "private credential detail" }, {}, { statusCode: 200 }])(
  "refuses invalid provider response without producing a verdict", async (payload) => {
    const provider = new JdoodleProvider({ ...configured,
      fetch: vi.fn(async () => new Response(JSON.stringify(payload))) as typeof fetch });
    await expect(provider.execute("class Solution {}"))
      .rejects.toMatchObject({ kind: "unavailable" });
  },
);
it("recognizes documented compiler output without an undocumented success flag", async () => {
  const provider = new JdoodleProvider({ ...configured,
    fetch: vi.fn(async () => new Response(JSON.stringify({ statusCode: 200,
      output: "Main.java:2: error: cannot find symbol" }))) as typeof fetch });
  await expect(provider.execute("class Solution {}"))
    .resolves.toMatchObject({ kind: "execution_error", verdict: "compile_error" });
});
