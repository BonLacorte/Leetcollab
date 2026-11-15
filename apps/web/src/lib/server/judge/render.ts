import { ProviderFailure, type ExecutionProvider, type ExecutionResult } from "./types";

// Offline preparation only. No environment reader, default fetch, or production selection.
// Wire contract: render-oss/sdk typescript/v1.8.0, commit
// 8b67d01c164e43ee4d5b720004efdbba9e26d9a3, experimental/sandboxes/index.ts.
const API = "https://api.render.com/v1";
const SOURCE = "/tmp/Main.java";
const COMPILE = "javac -proc:none -d /tmp /tmp/Main.java";
const RUN = "java -cp /tmp Main";
const ENVELOPE = 65_536;
const STDOUT = 16_384;
const DIAGNOSTICS = 4_096;

type MockConfig = Readonly<{
  workspaceId: string;
  groupId: string;
  imageId: string;
}>;
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Budget = { bytes: number };
type RecordValue = Record<string, unknown>;

function fail(): never {
  // Never include provider bodies, tokens, source, or transport errors here.
  throw new ProviderFailure("unavailable", "Render offline transport failed or returned ambiguous execution evidence.");
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as RecordValue;
}

function check(signal: AbortSignal) {
  if (signal.aborted) fail();
}

// Race as well as abort: even an injected transport that ignores its signal is bounded.
async function deadline<T>(ms: number, parent: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(abort, ms);
  let rejectAbort: (() => void) | undefined;
  try {
    check(controller.signal);
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new ProviderFailure("unavailable", "Render offline transport deadline or cancellation."));
        controller.signal.addEventListener("abort", rejectAbort, { once: true });
        if (controller.signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    controller.abort();
  }
}

async function read(response: Response, signal: AbortSignal, budget: Budget,
  consume: (text: string) => void): Promise<void> {
  if (!response.body) return;
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > ENVELOPE - budget.bytes)) {
    void response.body.cancel().catch(() => {});
    fail();
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      check(signal);
      const chunk = await reader.read();
      check(signal);
      if (chunk.done) break;
      // This happens before decoding, buffering incomplete frames, or event delivery.
      if (chunk.value.byteLength > ENVELOPE - budget.bytes) fail();
      budget.bytes += chunk.value.byteLength;
      consume(decoder.decode(chunk.value, { stream: true }));
    }
    consume(decoder.decode());
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

async function json(response: Response, signal: AbortSignal, budget: Budget): Promise<RecordValue> {
  let text = "";
  await read(response, signal, budget, (part) => { text += part; });
  return record(JSON.parse(text));
}

type CommandResult = { stdout: string; stderr: string; exit: number };

async function commandResult(response: Response, signal: AbortSignal, budget: Budget,
  outputBudget: { stdout: number; diagnostics: number }, compiling: boolean): Promise<CommandResult> {
  if (!response.body || response.headers.get("content-type")?.split(";")[0].trim() !== "text/event-stream") fail();
  let lineBuffer = "";
  let event = "";
  let data: string[] = [];
  let exit: number | undefined;
  let stdout = "";
  let stderr = "";
  const dispatch = () => {
    if (!event && !data.length) return;
    if (exit !== undefined) fail();
    const payload = record(JSON.parse(data.join("\n")));
    if (event === "output") {
      if (typeof payload.data !== "string" || !["stdout", "stderr"].includes(String(payload.stream))) fail();
      const bytes = Buffer.byteLength(payload.data, "utf8");
      if (compiling || payload.stream === "stderr") {
        outputBudget.diagnostics += bytes;
        if (outputBudget.diagnostics > DIAGNOSTICS) fail();
        stderr += payload.data;
      } else {
        outputBudget.stdout += bytes;
        if (outputBudget.stdout > STDOUT) fail();
        stdout += payload.data;
      }
    } else if (event === "exit") {
      if (!Number.isSafeInteger(payload.exit_code) || Number(payload.exit_code) < 0) fail();
      exit = Number(payload.exit_code);
    } else {
      fail(); // Includes provider error events, never trusted student text attribution.
    }
    event = "";
    data = [];
  };
  await read(response, signal, budget, (text) => {
    lineBuffer += text;
    let index: number;
    while ((index = lineBuffer.indexOf("\n")) >= 0) {
      const line = lineBuffer.slice(0, index).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(index + 1);
      if (!line) dispatch();
      else if (line.startsWith(":")) continue;
      else if (line.startsWith("event:")) {
        if (event) fail();
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      else fail();
    }
  });
  // Require complete frames and EOF, not just a possibly truncated terminal event.
  if (lineBuffer || event || data.length || exit === undefined) fail();
  return { stdout, stderr, exit };
}

export class RenderProvider implements ExecutionProvider {
  readonly configured: boolean;

  private constructor(private readonly mock?: { config: MockConfig; transport: Transport }) {
    this.configured = Boolean(mock);
  }

  static inactive(): RenderProvider { return new RenderProvider(); }

  /** Mock-only seam, not an activation flag. No live transport is supplied by this module. */
  static forOfflineTests(config: MockConfig, transport: Transport): RenderProvider {
    if (!/^tea-[0-9a-v]{20}$/.test(config.workspaceId)
      || !/^sbg-[0-9a-v]{20}$/.test(config.groupId)
      || !/^sbb-[0-9a-v]{20}$/.test(config.imageId)) fail();
    return new RenderProvider({ config: Object.freeze({ ...config }), transport });
  }

  async execute(source: string, signal?: AbortSignal): Promise<ExecutionResult> {
    if (!this.mock || Buffer.byteLength(source, "utf8") > ENVELOPE) fail();
    const { config, transport } = this.mock;
    const started = performance.now();
    const budget = { bytes: 0 };
    const outputBudget = { stdout: 0, diagnostics: 0 };
    let id: string | undefined;
    const ownerQuery = `ownerId=${config.workspaceId}`;
    const request = async (url: string, init: RequestInit, active: AbortSignal) => {
      check(active);
      const response = await transport(url, { ...init, signal: active, redirect: "error", cache: "no-store" });
      check(active);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        fail();
      }
      return response;
    };
    const control = async (path: string, active: AbortSignal, body?: unknown, method = "POST", b = budget) =>
      json(await request(`${API}${path}`, {
        method, headers: { "content-type": "application/json", accept: "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, active), active, b);
    const sandboxPath = () => `/sandboxes/${id}`;
    const connect = async (path: string, active: AbortSignal, body?: unknown) => {
      const token = await control(path, active, body);
      // Connect credentials are used only for the URI the provider supplies, never logged.
      if (typeof token.uri !== "string" || typeof token.token !== "string" || !token.token
        || typeof token.method !== "string") fail();
      const uri = new URL(token.uri);
      if (uri.protocol !== "https:" || uri.username || uri.password || uri.hash || uri.port
        || uri.hostname !== `${id}.oregon.sandbox.onrender.com`) fail();
      return { uri: uri.href, token: token.token, method: token.method };
    };
    const exec = (command: string, ms: number, main: AbortSignal, compiling: boolean) =>
      deadline(ms, main, async (active) => {
        const token = await connect(`${sandboxPath()}/runs/stream/token?${ownerQuery}`, active, { command });
        if (token.method !== "POST") fail();
        const response = await request(token.uri, {
          method: token.method,
          headers: { authorization: `Bearer ${token.token}`, "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ command }),
        }, active);
        return commandResult(response, active, budget, outputBudget, compiling);
      });
    try {
      // At most 22s main + 3s independent termination, within the unchanged 30s route.
      return await deadline<ExecutionResult>(22_000, signal, async (main) => {
        let sandbox = await deadline(3_000, main, async (active) => {
          const created = await control("/sandboxes", active, {
            ownerId: config.workspaceId, sandboxGroupId: config.groupId, buildId: config.imageId,
            plan: "1c-2g", timeoutSeconds: 60, idleTimeoutSeconds: 300,
            networkPolicy: { type: "deny-all" }, env: {},
          });
          if (typeof created.id !== "string" || !/^sbx-[0-9a-v]{1,64}$/.test(created.id)) fail();
          id = created.id; // Capture before validating readiness or other metadata.
          return created;
        });
        await deadline(5_000, main, async (active) => {
          while (true) {
            check(active);
            if (sandbox.id !== id || sandbox.sandboxGroupId !== config.groupId) fail();
            if (sandbox.status === "running") return;
            if (sandbox.status !== "creating") fail();
            await new Promise<void>((resolve) => {
              const timer = setTimeout(done, 250);
              function done() { clearTimeout(timer); active.removeEventListener("abort", done); resolve(); }
              active.addEventListener("abort", done, { once: true });
              if (active.aborted) done();
            });
            sandbox = await control(`${sandboxPath()}?${ownerQuery}`, active, undefined, "GET");
          }
        });
        await deadline(2_000, main, async (active) => {
          const token = await connect(`${sandboxPath()}/files/upload/token?${ownerQuery}&path=${encodeURIComponent(SOURCE)}`, active);
          if (token.method !== "PUT") fail();
          const uploaded = await request(token.uri, {
            method: token.method,
            headers: { authorization: `Bearer ${token.token}`, "content-type": "application/octet-stream" },
            body: source,
          }, active);
          await read(uploaded, active, budget, () => {});
        });
        const compiled = await exec(COMPILE, 5_000, main, true);
        const result = compiled.exit === 0 ? await exec(RUN, 2_000, main, false) : compiled;
        const durationMs = Math.round(performance.now() - started);
        if (compiled.exit !== 0 || result.exit !== 0) {
          return { kind: "execution_error", verdict: compiled.exit !== 0 ? "compile_error" : "runtime_error",
            diagnostics: result.stderr || "The sandbox command exited unsuccessfully.", durationMs, cpuTime: null, memory: null };
        }
        return { kind: "completed", output: result.stdout, durationMs, cpuTime: null, memory: null };
      });
    } catch {
      return fail();
    } finally {
      if (id) {
        try {
          // Never use the main/client signal for cleanup. No retry, suspend, or reuse.
          await deadline(3_000, undefined, async (active) => {
            const response = await request(`${API}${sandboxPath()}/terminate?${ownerQuery}`, { method: "POST" }, active);
            if (response.status !== 200 && response.status !== 204) {
              void response.body?.cancel().catch(() => {});
              fail();
            }
            await read(response, active, { bytes: 0 }, () => {});
          });
        } catch { fail(); }
      }
    }
  }
}
