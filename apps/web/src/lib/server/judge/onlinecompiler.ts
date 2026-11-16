import { ProviderFailure, type ExecutionProvider, type ExecutionResult } from "./types";

export type OnlineCompilerOptions = {
  apiKey?: string;
  policyAccepted?: boolean;
  executionApproved?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

const ENDPOINT = "https://api.onlinecompiler.io/api/run-code-sync/";
const SOURCE_BYTES = 65_536;
const RESPONSE_BYTES = 65_536;
const OUTPUT_BYTES = 16_384;
const DIAGNOSTIC_BYTES = 4_096;

class ResponseTooLarge extends Error {}
class RefusedRequest extends Error {
  constructor(readonly status: number) { super(); }
}

function unavailable(): never {
  // Fetch errors, malformed bodies and compiler output can contain credentials or source.
  throw new ProviderFailure("unavailable", "OnlineCompiler did not return a complete execution result before the broker deadline.");
}

function check(signal: AbortSignal): void {
  if (signal.aborted) unavailable();
}

function programForSourceMode(source: string): string {
  // The caller appends this reserved, trusted harness after the user's Solution.
  // OnlineCompiler chooses the public class if the first class has no main method.
  const declarations = source.match(/\b(?:public\s+)?class\s+Main\s*\{/g);
  if (declarations?.length !== 1 || Buffer.byteLength(source, "utf8") > SOURCE_BYTES) unavailable();
  const program = source.replace(/\b(?:public\s+)?class\s+Main\s*\{/, "public class Main {");
  if (Buffer.byteLength(program, "utf8") > SOURCE_BYTES) unavailable();
  return program;
}

async function readResponse(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    if (/^\d+$/.test(length) && Number(length) > RESPONSE_BYTES) throw new ResponseTooLarge();
    unavailable();
  }
  if (!response.body) unavailable();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      check(signal);
      const chunk = await reader.read();
      check(signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > RESPONSE_BYTES) throw new ResponseTooLarge();
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

function measurement(value: unknown): string | null {
  if ((typeof value !== "string" && typeof value !== "number")
    || !/^\d+(?:\.\d+)?$/.test(String(value)) || !Number.isFinite(Number(value))) return null;
  return String(value);
}

function resultFromBody(body: string, durationMs: number): ExecutionResult {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) unavailable();
  const payload = parsed as Record<string, unknown>;
  if (typeof payload.output !== "string" || typeof payload.error !== "string"
    || (payload.status !== "success" && payload.status !== "error")
    || !Number.isInteger(payload.exit_code) || Number(payload.exit_code) < 0 || Number(payload.exit_code) > 255
    || (payload.signal !== null && (!Number.isInteger(payload.signal) || Number(payload.signal) < 1 || Number(payload.signal) > 127))
    || typeof payload.truncated !== "boolean"
    || (payload.files_truncated !== undefined && typeof payload.files_truncated !== "boolean")) unavailable();

  const exit = Number(payload.exit_code);
  const signal = payload.signal as number | null;
  if ((signal !== null && exit !== 128 + signal)
    || (payload.status === "success" && (exit !== 0 || signal !== null))
    || (payload.status === "error" && exit === 0)) unavailable();

  // The provider's `time` is wall time, not a CPU measurement. Do not relabel it.
  const common = { durationMs, cpuTime: null, memory: measurement(payload.memory) };
  if (payload.truncated || payload.files_truncated
    || Buffer.byteLength(payload.output, "utf8") > OUTPUT_BYTES
    || Buffer.byteLength(payload.error, "utf8") > DIAGNOSTIC_BYTES
    || (exit === 153 && signal === 25)) {
    return { kind: "execution_error", verdict: "output_limit", diagnostics: "The external sandbox output exceeded LeetCollab's output limits.", ...common };
  }
  if (exit === 124 && signal === null) {
    return { kind: "execution_error", verdict: "time_limit", diagnostics: "The external sandbox stopped the Java program at its time limit.", ...common };
  }
  if (exit === 137 && signal === 9) {
    return { kind: "execution_error", verdict: "memory_limit", diagnostics: "The external sandbox stopped the Java program at its memory limit.", ...common };
  }
  if (exit !== 0) {
    // Java source mode uses exit 1 for both compilation and runtime errors. Only a
    // compiler location at the start of a diagnostic line identifies compilation.
    const compiler = signal === null && exit === 1
      ? /(?:^|\n)(?:\/[^\r\n]*\/)?(?:Main|code)\.java:(\d+)(?::\d+)?:\s*error:/m.exec(payload.error)
      : null;
    return {
      kind: "execution_error",
      verdict: compiler ? "compile_error" : "runtime_error",
      // Never persist compiler source echoes or arbitrary provider diagnostic text.
      diagnostics: compiler
        ? `Java compilation failed at line ${Number(compiler[1])}. Correct the source and try again.`
        : `The Java program exited unsuccessfully (exit code ${exit}).`,
      ...common,
    };
  }
  return { kind: "completed", output: payload.output, ...common };
}

/** Disabled by default. A key or provider selection alone never enables execution. */
export class OnlineCompilerProvider implements ExecutionProvider {
  readonly id = "onlinecompiler" as const;
  readonly configured: boolean;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;
  private readonly apiKey: string;

  constructor(options: OnlineCompilerOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.configured = Boolean(this.apiKey && !/[\r\n]/.test(this.apiKey)
      && options.policyAccepted === true && options.executionApproved === true);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  static fromEnvironment(): OnlineCompilerProvider {
    return new OnlineCompilerProvider({
      apiKey: process.env.ONLINECOMPILER_API_KEY,
      policyAccepted: process.env.ONLINECOMPILER_POLICY_ACCEPTED === "true",
      executionApproved: process.env.ONLINECOMPILER_EXECUTION_APPROVED === "true",
      timeoutMs: process.env.JUDGE_REQUEST_TIMEOUT_MS ? Number(process.env.JUDGE_REQUEST_TIMEOUT_MS) : undefined,
    });
  }

  async execute(source: string): Promise<ExecutionResult> {
    if (!this.configured) {
      throw new ProviderFailure("unavailable", "OnlineCompiler server configuration, accepted provider policy and execution approval are required.");
    }
    return executeOnlineCompilerProgram(source, this.apiKey, this.timeoutMs, this.fetch);
  }
}

export async function executeOnlineCompilerProgram(
  source: string,
  apiKey: string,
  timeoutMs: number,
  request: typeof fetch = globalThis.fetch,
): Promise<ExecutionResult> {
  apiKey = apiKey.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) unavailable();
  timeoutMs = Math.min(30_000, Math.max(1_000,
    Number.isFinite(timeoutMs) ? timeoutMs : 15_000));
  const program = programForSourceMode(source);
  const started = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error());
    }, timeoutMs);
  });
  const work = async (): Promise<ExecutionResult> => {
    const response = await request(ENDPOINT, {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ compiler: "openjdk-25", code: program }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (controller.signal.aborted || response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      if (controller.signal.aborted) unavailable();
      throw new RefusedRequest(response.status);
    }
    const body = await readResponse(response, controller.signal);
    return resultFromBody(body, Math.max(0, Math.round(performance.now() - started)));
  };
  try {
    return await Promise.race([work(), expired]);
  } catch (error) {
    if (error instanceof ResponseTooLarge) {
      return {
        kind: "execution_error", verdict: "output_limit",
        diagnostics: "The external sandbox response exceeded LeetCollab's 64 KB response limit.",
        durationMs: Math.max(0, Math.round(performance.now() - started)), cpuTime: null, memory: null,
      };
    }
    if (error instanceof RefusedRequest) {
      // 429 also means capacity/rate refusal. Do not exhaust shared quota on that evidence.
      throw new ProviderFailure("unavailable", `OnlineCompiler refused the request (HTTP ${error.status}).`);
    }
    return unavailable();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
