import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderProvider } from "./render";

// Oracle: official SDK v1.8.0 (8b67d01), create/get/terminate/file/exec wire
// operations and event fixtures. All HTTP here is injected; no source is executed.
const config = {
  workspaceId: "tea-csprhmi3esus73alsv70",
  groupId: "sbg-cph1rs3idesc73a2b2mg",
  imageId: "sbb-cph1rs3idesc73a2b2mg",
  toolchain: "synthetic-jdk-21-image",
};
const id = "sbx-1cd4gcph1rs3idesc73a2b2mg";
const proxy = `https://${id}.oregon.sandbox.onrender.com`;
const sandbox = { id, sandboxGroupId: config.groupId, status: "running" };
const encode = (s: string) => new TextEncoder().encode(s);
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const output = (data: string, stream = "stdout") => frame("output", { stream, data });
const exit = (exit_code = 0) => frame("exit", { exit_code });
const json = (data: unknown) => new Response(JSON.stringify(data));
function stream(parts: (string | Uint8Array)[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(typeof part === "string" ? encode(part) : part);
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

type Override = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;
function fixture(override?: Override) {
  const request = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const replacement = override?.(u, init);
    if (replacement !== undefined) return replacement;
    if (u.pathname === "/v1/sandboxes") return json(sandbox);
    if (u.pathname.endsWith("/terminate")) return new Response(null, { status: 204 });
    if (u.pathname === `/v1/sandboxes/${id}`) return json(sandbox);
    if (u.pathname.endsWith("/files/upload/token")) return json({ uri: `${proxy}/files/upload`, method: "PUT", token: "mock-file-token" });
    if (u.pathname === "/files/upload") return new Response(null, { status: 204 });
    if (u.pathname.endsWith("/runs/stream/token")) return json({ uri: `${proxy}/runs/stream`, method: "POST", token: "mock-run-token" });
    if (u.pathname === "/runs/stream") {
      return stream([String(init.body).includes("javac") ? exit() : output("42\n") + exit()]);
    }
    throw new Error(`Unexpected mock request ${u.pathname}`);
  });
  return { request, provider: RenderProvider.forOfflineTests(config, request) };
}
function terminated(request: ReturnType<typeof fixture>["request"]) {
  return request.mock.calls.filter(([u]) => new URL(u).pathname.endsWith("/terminate"));
}
function never(): Promise<Response> { return new Promise(() => {}); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Render offline preparation", () => {
  it("stays inactive without the explicit mock seam, regardless of environment flags", async () => {
    vi.stubEnv("RENDER_ENABLED", "true");
    vi.stubEnv("RENDER_API_KEY", "mock-not-a-key");
    const network = vi.fn(() => { throw new Error("Network forbidden"); });
    vi.stubGlobal("fetch", network);
    const provider = RenderProvider.inactive();
    expect(provider.configured).toBe(false);
    await expect(provider.execute("source data")).rejects.toMatchObject({ kind: "unavailable" });
    expect(network).not.toHaveBeenCalled();
  });

  it("creates one fresh deny-all sandbox from a fixed identity and uploads source only as data", async () => {
    const { provider, request } = fixture();
    const source = 'class Main {} // $(curl evil); `command`';
    await expect(provider.execute(source)).resolves.toMatchObject({ kind: "completed", output: "42\n" });
    expect(request.mock.calls[0][0]).toBe("https://api.render.com/v1/sandboxes");
    expect(JSON.parse(String(request.mock.calls[0][1].body))).toEqual({
      ownerId: config.workspaceId, sandboxGroupId: config.groupId, buildId: config.imageId,
      plan: "1c-2g", timeoutSeconds: 60, idleTimeoutSeconds: 300,
      networkPolicy: { type: "deny-all" }, env: {},
    });
    const fileToken = request.mock.calls.find(([u]) => u.includes("/files/upload/token"))!;
    expect(new URL(fileToken[0]).searchParams.get("path")).toBe("/tmp/Main.java");
    const upload = request.mock.calls.find(([u]) => u === `${proxy}/files/upload`)!;
    expect(upload[1]).toMatchObject({ method: "PUT", body: source,
      headers: { authorization: "Bearer mock-file-token", "content-type": "application/octet-stream" } });
    const commands = request.mock.calls.filter(([u]) => u.includes("/runs/stream/token"));
    expect(commands.map(([, init]) => JSON.parse(String(init.body)))).toEqual([
      { command: "javac -proc:none -d /tmp /tmp/Main.java" }, { command: "java -cp /tmp Main" },
    ]);
    expect(terminated(request)).toHaveLength(1);
    for (const [, init] of request.mock.calls) {
      expect(init.redirect).toBe("error");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("never retries a lost creation acknowledgement", async () => {
    const { provider, request } = fixture(() => { throw new Error("Lost acknowledgement"); });
    await expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(terminated(request)).toHaveLength(0);
  });

  it.each([
    ["readiness", (u: URL) => u.pathname === "/v1/sandboxes" ? json({ ...sandbox, status: "errored" }) : undefined],
    ["identity", (u: URL) => u.pathname === "/v1/sandboxes" ? json({ ...sandbox, sandboxGroupId: "wrong" }) : undefined],
    ["upload token", (u: URL) => u.pathname.endsWith("/files/upload/token") ? new Response("", { status: 500 }) : undefined],
    ["upload", (u: URL) => u.pathname === "/files/upload" ? new Response("", { status: 500 }) : undefined],
    ["exec token", (u: URL) => u.pathname.endsWith("/runs/stream/token") ? json({ uri: "http://localhost/", method: "POST", token: "mock" }) : undefined],
  ] as const)("terminates acknowledged IDs on %s failure", async (_, override) => {
    const { provider, request } = fixture(override);
    await expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    expect(terminated(request)).toHaveLength(1);
  });

  it("polls creating state without repeating create", async () => {
    vi.useFakeTimers();
    const { provider, request } = fixture((u) => u.pathname === "/v1/sandboxes" ? json({ ...sandbox, status: "creating" }) : undefined);
    const result = provider.execute("source");
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toMatchObject({ kind: "completed" });
    expect(request.mock.calls.filter(([u]) => new URL(u).pathname === "/v1/sandboxes")).toHaveLength(1);
  });

  it.each([
    ["create", 3_000, "/v1/sandboxes", false],
    ["readiness", 5_000, `/v1/sandboxes/${id}`, true],
    ["upload", 2_000, "/files/upload", true],
    ["compile", 5_000, "/runs/stream", true],
  ] as const)("bounds stalled %s HTTP even if transport ignores abort", async (_, ms, path, cleanup) => {
    vi.useFakeTimers();
    const { provider, request } = fixture((u) => {
      if (u.pathname === path) return never();
      if (path === `/v1/sandboxes/${id}` && u.pathname === "/v1/sandboxes") return json({ ...sandbox, status: "creating" });
    });
    const result = expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(ms + 1);
    await result;
    expect(terminated(request)).toHaveLength(cleanup ? 1 : 0);
  });

  it("uses an independent termination signal after the caller aborts", async () => {
    const abort = new AbortController();
    const { provider, request } = fixture((u, init) => {
      if (u.pathname === "/files/upload") { abort.abort(); return never(); }
      if (u.pathname.endsWith("/terminate")) expect(init.signal?.aborted).toBe(false);
    });
    await expect(provider.execute("source", abort.signal)).rejects.toMatchObject({ kind: "unavailable" });
    const cleanup = terminated(request)[0][1].signal!;
    // Completed stage signals are aborted on release; independence is observed in the mock below.
    expect(cleanup).not.toBe(abort.signal);
    expect(terminated(request)).toHaveLength(1);
  });

  it.each(["http", "timeout", "ambiguous"])("refuses success on cleanup %s failure", async (mode) => {
    vi.useFakeTimers();
    const { provider, request } = fixture((u, init) => {
      if (u.pathname.endsWith("/terminate")) {
        expect(init.signal?.aborted).toBe(false);
        return mode === "http" ? new Response("", { status: 503 })
          : mode === "ambiguous" ? new Response("", { status: 202 }) : never();
      }
    });
    const result = expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(3_001);
    await result;
    expect(terminated(request)).toHaveLength(1);
  });

  it.each([
    ["missing exit", output("42\n")], ["malformed JSON", "event: exit\ndata: nope\n\n"],
    ["missing exit code", frame("exit", {})], ["invalid exit", frame("exit", { exit_code: "0" })],
    ["error event", frame("error", { status: 500, message: "secret detail" })],
    ["unknown event", frame("wat", {})], ["incomplete exit", exit().slice(0, -1)],
    ["post-exit output", exit() + output("bad")], ["wrong stream", output("bad", "combined")],
  ])("rejects %s without a completed result", async (_, text) => {
    const { provider, request } = fixture((u) => u.pathname === "/runs/stream" ? stream([text]) : undefined);
    await expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    expect(terminated(request)).toHaveLength(1);
  });

  it.each([
    ["oversized single chunk", ["x".repeat(65_537)]],
    ["incomplete line", Array(66).fill("x".repeat(1_024))],
    ["multiline incomplete event", Array(600).fill(`data: ${"x".repeat(120)}\n`)],
    ["stdout bytes", [output("界".repeat(5_462)) + exit()]],
    ["diagnostic bytes", [output("界".repeat(1_366), "stderr") + exit()]],
  ] as [string, string[]][])("caps %s before accepting output", async (_, parts) => {
    const { provider, request } = fixture((u, init) => u.pathname === "/runs/stream" && !String(init.body).includes("javac") ? stream(parts) : undefined);
    await expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    expect(terminated(request)).toHaveLength(1);
  });

  it("decodes split UTF-8 and multiline SSE JSON while keeping stderr out of stdout", async () => {
    const bytes = encode(output("界\n") + 'event: output\ndata: {"stream":"stderr",\ndata: "data":"warning"}\n\n' + exit());
    const { provider } = fixture((u, init) => u.pathname === "/runs/stream" && !String(init.body).includes("javac")
      ? stream(Array.from(bytes, (byte) => new Uint8Array([byte]))) : undefined);
    await expect(provider.execute("source")).resolves.toMatchObject({ kind: "completed", output: "界\n" });
  });

  it.each([true, false])("reports nonzero command exit, compiling=%s", async (compiling) => {
    const { provider, request } = fixture((u, init) => {
      if (u.pathname === "/runs/stream" && String(init.body).includes("javac") === compiling)
        return stream([output("diagnostic", "stderr"), exit(1)]);
    });
    await expect(provider.execute("source")).resolves.toMatchObject({ kind: "execution_error",
      verdict: compiling ? "compile_error" : "runtime_error", diagnostics: "diagnostic" });
    expect(request.mock.calls.filter(([u]) => u.endsWith("/runs/stream"))).toHaveLength(compiling ? 1 : 2);
    expect(terminated(request)).toHaveLength(1);
  });

  it("bounds runtime independently of compile", async () => {
    vi.useFakeTimers();
    const { provider, request } = fixture((u, init) => u.pathname === "/runs/stream" && !String(init.body).includes("javac") ? never() : undefined);
    const result = expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(2_001);
    await result;
    expect(terminated(request)).toHaveLength(1);
  });

  it("bounds stalled SSE body consumption and cancels the reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { provider, request } = fixture((u) => u.pathname === "/runs/stream"
      ? new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/event-stream" } }) : undefined);
    const result = expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    await vi.advanceTimersByTimeAsync(5_001);
    await result;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(terminated(request)).toHaveLength(1);
  });

  it("accepts the exact stdout and diagnostics byte limits separately", async () => {
    const { provider } = fixture((u, init) => u.pathname === "/runs/stream" && !String(init.body).includes("javac")
      ? stream([output("x".repeat(16_384)), output("y".repeat(4_096), "stderr"), exit()]) : undefined);
    await expect(provider.execute("source")).resolves.toMatchObject({ kind: "completed", output: "x".repeat(16_384) });
  });

  it("shares the raw envelope budget across compile and runtime, including comments", async () => {
    const { provider, request } = fixture((u) => u.pathname === "/runs/stream"
      ? stream([`:${"x".repeat(33_000)}\n\n`, exit()]) : undefined);
    await expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
    expect(terminated(request)).toHaveLength(1);
  });

  it("shares diagnostics budget across compiler output and runtime stderr", async () => {
    const { provider } = fixture((u, init) => u.pathname === "/runs/stream"
      ? stream([output("x".repeat(2_049), String(init.body).includes("javac") ? "stdout" : "stderr"), exit()]) : undefined);
    await expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("rejects invalid UTF-8 and cancels oversized responses without trusting event delivery", async () => {
    for (const response of [stream([new Uint8Array([0xff])]), new Response("", {
      headers: { "content-length": "65537", "content-type": "text/event-stream" },
    })]) {
      const { provider, request } = fixture((u) => u.pathname === "/runs/stream" ? response : undefined);
      await expect(provider.execute("source")).rejects.toMatchObject({ kind: "unavailable" });
      expect(terminated(request)).toHaveLength(1);
    }
  });

  it("rejects oversized source or pre-abort before creation", async () => {
    const { provider, request } = fixture();
    await expect(provider.execute("界".repeat(21_846))).rejects.toMatchObject({ kind: "unavailable" });
    await expect(provider.execute("source", AbortSignal.abort())).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("durable Render attempt callbacks through injected transport", () => {
  const attemptId = "11111111-1111-4111-8111-111111111111";
  it("persists creating before POST, labels it, and records ID and cleanup in order", async () => {
    const events: string[] = [];
    const { provider, request } = fixture((url) => {
      if (url.pathname === "/v1/sandboxes") events.push("POST");
      if (url.pathname.endsWith("/terminate")) events.push("terminate");
      return undefined;
    });
    await provider.execute("source", {
      id: attemptId,
      begin: async () => { events.push("begin"); },
      acknowledge: async (resource) => { expect(resource).toBe(id); events.push("ack"); },
      cleanupAcknowledged: async (resource) => { expect(resource).toBe(id); events.push("cleanup ack"); },
    });
    expect(events).toEqual(["begin", "POST", "ack", "terminate", "cleanup ack"]);
    expect(JSON.parse(String(request.mock.calls[0][1].body)).name).toBe(`leetcollab-${attemptId}`);
    expect(provider.provenance).toEqual({ provider: "render", ...config });
  });
  it("never creates when durable begin fails", async () => {
    const { provider, request } = fixture();
    await expect(provider.execute("source", {
      id: attemptId, begin: async () => { throw new Error("Database unavailable"); },
      acknowledge: vi.fn(), cleanupAcknowledged: vi.fn(),
    })).rejects.toMatchObject({ kind: "unavailable" });
    expect(request).not.toHaveBeenCalled();
  });
  it("leaves a lost create acknowledgement unresolved without retry or cleanup fabrication", async () => {
    const { provider, request } = fixture(() => { throw new Error("Lost acknowledgement"); });
    const attempt = { id: attemptId, begin: vi.fn(), acknowledge: vi.fn(), cleanupAcknowledged: vi.fn() };
    await expect(provider.execute("source", attempt)).rejects.toMatchObject({ kind: "unavailable" });
    expect(attempt.begin).toHaveBeenCalledOnce();
    expect(attempt.acknowledge).not.toHaveBeenCalled();
    expect(attempt.cleanupAcknowledged).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });
  it("rejects completion when cleanup evidence cannot be persisted", async () => {
    const { provider, request } = fixture();
    await expect(provider.execute("source", {
      id: attemptId, begin: vi.fn(), acknowledge: vi.fn(),
      cleanupAcknowledged: async () => { throw new Error("Lost database acknowledgement"); },
    })).rejects.toMatchObject({ kind: "unavailable" });
    expect(terminated(request)).toHaveLength(1);
  });
});
