import { afterEach, describe, expect, it, vi } from "vitest";
import { OnlineCompilerProvider } from "./onlinecompiler";
import { buildJavaProgram } from "./safety";

// Oracles: OnlineCompiler.io /docs/run-code, /docs/compilers and /docs/limits.
// Responses and credentials are synthetic; these tests never run Java or contact a provider.
const configured = {
  apiKey: "synthetic-server-rest-key",
  limitsConfirmed: true,
  executionApproved: true,
};
const solution = `class Solution {
  public static int[] findPair(int[] weights, int capacity) {
    return new int[0];
  }
}`;
// The trusted Parcel Pair fixture from the curated-problem migration.
const harness = `class Main {
  public static void main(String[] args) {
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{4,7,1,9}, 10)));
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{6,2,8}, 14)));
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{5,6}, 20)));
  }
}`;
const program = buildJavaProgram(solution, harness);
const passingOutput = "[2, 3]\n[0, 2]\n[]\n";

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    output: passingOutput,
    error: "",
    status: "success",
    exit_code: 0,
    signal: null,
    truncated: false,
    time: "0.0248",
    total: "0.0330",
    memory: "8192",
    ...overrides,
  };
}

function respond(body = payload(), init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
}

function providerWith(body = payload()) {
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => respond(body));
  return {
    provider: new OnlineCompilerProvider({ ...configured, fetch: request as typeof fetch }),
    request,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OnlineCompilerProvider", () => {
  it("sends one documented server REST request with a supported public Main entry point", async () => {
    const { provider, request } = providerWith();
    const result = await provider.execute(program);

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.onlinecompiler.io/api/run-code-sync/");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe(configured.apiKey);
    expect(String(url)).not.toContain(configured.apiKey);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ compiler: "openjdk-25" });
    expect(Object.keys(body).sort()).toEqual(["code", "compiler"]);
    // This emitted program is the provider-facing entry-point contract, not a source-code proxy.
    expect(body.code).toBe(`${solution}\n\npublic ${harness}\n`);
    expect(body).not.toHaveProperty("clientSecret");
    expect(body).not.toHaveProperty("versionIndex");
    expect(body).not.toHaveProperty("files");
    expect(result).toMatchObject({ kind: "completed", output: passingOutput, cpuTime: null, memory: "8192" });
  });

  it("returns wrong stdout to the trusted comparator instead of assigning provider acceptance", async () => {
    const { provider } = providerWith(payload({ output: "[]\n[]\n[]\n" }));
    await expect(provider.execute(program)).resolves.toMatchObject({
      kind: "completed",
      output: "[]\n[]\n[]\n",
    });
  });

  it.each([
    {},
    { apiKey: "" },
    { limitsConfirmed: false },
    { executionApproved: false },
  ])("does not issue a request unless credentials and both approvals are present: %j", async options => {
    const request = vi.fn();
    const provider = new OnlineCompilerProvider({
      ...(Object.keys(options).length ? configured : {}),
      ...options,
      fetch: request as typeof fetch,
    });
    expect(provider.configured).toBe(false);
    await expect(provider.execute(program)).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([undefined, "false", "1", "TRUE", "true"])("requires exact environment approvals: %s", async value => {
    vi.stubEnv("ONLINECOMPILER_API_KEY", configured.apiKey);
    vi.stubEnv("ONLINECOMPILER_LIMITS_CONFIRMED", value);
    vi.stubEnv("ONLINECOMPILER_EXECUTION_APPROVED", value);
    const request = vi.fn(async () => respond());
    vi.stubGlobal("fetch", request);
    const provider = OnlineCompilerProvider.fromEnvironment();
    expect(provider.configured).toBe(value === "true");
    if (value === "true") {
      await expect(provider.execute(program)).resolves.toMatchObject({ kind: "completed" });
      expect(request).toHaveBeenCalledTimes(1);
    } else {
      await expect(provider.execute(program)).rejects.toMatchObject({ kind: "unavailable" });
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("rejects a source exceeding the byte cap before spending an execution", async () => {
    const { provider, request } = providerWith();
    const multibyteSource = `/*${"💡".repeat(16_384)}*/\n${program}`;
    expect(multibyteSource.length).toBeLessThan(65_536);
    await expect(provider.execute(multibyteSource)).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "class Solution {}",
    `${program}\nclass Main { public static void main(String[] a) {} }`,
  ])("refuses an absent or ambiguous reserved entry point without a provider request", async source => {
    const { provider, request } = providerWith();
    await expect(provider.execute(source)).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500, 503])("refuses HTTP %s without retrying or exposing its body", async status => {
    const privateText = `${configured.apiKey}\n${program}`;
    const request = vi.fn(async () => new Response(privateText, { status }));
    const provider = new OnlineCompilerProvider({ ...configured, fetch: request as typeof fetch });
    const failure = await provider.execute(program).catch(error => error);
    expect(failure).toMatchObject({ kind: "unavailable" });
    expect(failure.message).not.toContain(configured.apiKey);
    expect(failure.message).not.toContain(solution);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect instead of following it or trying a fallback", async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { location: "https://untrusted.example/collect" },
    }));
    const provider = new OnlineCompilerProvider({ ...configured, fetch: request as typeof fetch });
    await expect(provider.execute(program)).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("sanitizes a transport failure instead of logging source or credentials", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi.fn(async () => { throw new Error(`${configured.apiKey}\n${program}`); });
    const provider = new OnlineCompilerProvider({ ...configured, fetch: request as typeof fetch });
    const failure = await provider.execute(program).catch(error => error);
    expect(failure).toMatchObject({ kind: "unavailable" });
    expect(failure.message).not.toContain(configured.apiKey);
    expect(failure.message).not.toContain(solution);
    expect(log).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    { exit_code: undefined },
    { exit_code: "0" },
    { exit_code: -1 },
    { exit_code: 256 },
    { output: null },
    { error: [] },
    { status: "queued" },
    { status: "success", exit_code: 1 },
    { status: "error", exit_code: 0 },
    { signal: 9 },
    { signal: 0 },
    { truncated: "false" },
    { truncated: undefined },
  ])("requires an intact consistent execution envelope: %j", async overrides => {
    const { provider, request } = providerWith(payload(overrides));
    await expect(provider.execute(program)).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["not JSON", "[]", "null"])("refuses malformed or non-object JSON: %s", async body => {
    const request = vi.fn(async () => new Response(body, { headers: { "content-type": "application/json" } }));
    const provider = new OnlineCompilerProvider({ ...configured, fetch: request as typeof fetch });
    await expect(provider.execute(program)).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["truncated streams", { truncated: true }],
    ["truncated files", { files_truncated: true }],
    ["multibyte stdout over 16 KiB", { output: "é".repeat(8_193) }],
    ["multibyte stderr over 4 KiB", { error: "é".repeat(2_049) }],
  ] as const)("never returns comparable output after %s", async (_label, overrides) => {
    const { provider } = providerWith(payload(overrides));
    await expect(provider.execute(program)).resolves.toMatchObject({ kind: "execution_error", verdict: "output_limit" });
  });

  it("allows stdout at the exact byte cap", async () => {
    const output = "é".repeat(8_192);
    const { provider } = providerWith(payload({ output }));
    await expect(provider.execute(program)).resolves.toMatchObject({ kind: "completed", output });
  });

  it("stops a streamed response at the raw envelope cap without relying on content-length", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(" ".repeat(65_536)));
        controller.enqueue(new TextEncoder().encode(JSON.stringify(payload())));
      },
      cancel() { cancelled = true; },
    });
    const request = vi.fn(async () => new Response(stream, { headers: { "content-type": "application/json" } }));
    const provider = new OnlineCompilerProvider({ ...configured, fetch: request as typeof fetch });
    await expect(provider.execute(program)).resolves.toMatchObject({ kind: "execution_error", verdict: "output_limit" });
    expect(cancelled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("preserves a multibyte output character split across transport chunks", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify(payload({ output: "π\n" })));
    const characterAt = encoded.findIndex(byte => byte === 0xcf);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, characterAt + 1));
        controller.enqueue(encoded.slice(characterAt + 1));
        controller.close();
      },
    });
    const request = vi.fn(async () => new Response(stream, { headers: { "content-type": "application/json" } }));
    await expect(new OnlineCompilerProvider({ ...configured, fetch: request as typeof fetch }).execute(program))
      .resolves.toMatchObject({ kind: "completed", output: "π\n" });
  });

  it("reports anchored Java compiler diagnostics while withholding submitted text", async () => {
    const { provider } = providerWith(payload({
      status: "error", exit_code: 1, output: "",
      error: `Main.java:4: error: ';' expected\n${solution}\n${configured.apiKey}\n`,
    }));
    const result = await provider.execute(program);
    expect(result).toMatchObject({ kind: "execution_error", verdict: "compile_error" });
    if (result.kind !== "execution_error") throw new Error("Expected an execution error.");
    expect(result.diagnostics).not.toContain(solution);
    expect(result.diagnostics).not.toContain(configured.apiKey);
  });

  it("does not infer a compiler failure from arbitrary runtime stderr", async () => {
    const { provider } = providerWith(payload({ status: "error", exit_code: 1, error: "student says compile error" }));
    await expect(provider.execute(program)).resolves.toMatchObject({ kind: "execution_error", verdict: "runtime_error" });
  });

  it.each([
    [124, null, "time_limit"],
    [137, 9, "memory_limit"],
    [153, 25, "output_limit"],
    [71, null, "runtime_error"],
    [139, 11, "runtime_error"],
  ])("maps documented stopped-run status %s/%s to %s", async (exit, signal, verdict) => {
    const { provider } = providerWith(payload({ status: "error", exit_code: exit, signal, error: "stopped", output: "" }));
    await expect(provider.execute(program)).resolves.toMatchObject({ kind: "execution_error", verdict });
  });

  it("bounds a transport that ignores its abort signal and does not retry", async () => {
    vi.useFakeTimers();
    const request = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>(() => {}));
    const provider = new OnlineCompilerProvider({ ...configured, timeoutMs: 1_000, fetch: request as typeof fetch });
    const rejected = expect(provider.execute(program)).rejects.toMatchObject({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;
    expect((request.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline active after headers arrive while the body is stalled", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"output":')); },
    }), { headers: { "content-type": "application/json" } }));
    const provider = new OnlineCompilerProvider({ ...configured, timeoutMs: 1_000, fetch: request as typeof fetch });
    const rejected = expect(provider.execute(program)).rejects.toMatchObject({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;
    expect((request.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
