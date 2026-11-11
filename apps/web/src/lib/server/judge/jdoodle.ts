import { ProviderFailure, type ExecutionProvider, type ExecutionResult } from "./types";

type Fetch = typeof fetch;

type JdoodleOptions = {
  clientId?: string;
  clientSecret?: string;
  javaVersionIndex?: string;
  limitsConfirmed?: boolean;
  timeoutMs?: number;
  fetch?: Fetch;
};

class ResponseTooLarge extends Error {}

async function readBounded(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new ResponseTooLarge();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ResponseTooLarge();
    }
    chunks.push(result.value);
  }

  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function stringField(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function executionFailure(output: string, durationMs: number, cpuTime: string | null, memory: string | null): ExecutionResult {
  const diagnostics = output.slice(0, 4096) || "The external sandbox did not report execution details.";
  if (/time\s+limit|timed\s*out/i.test(output)) {
    return { kind: "execution_error", verdict: "time_limit", diagnostics, durationMs, cpuTime, memory };
  }
  if (/memory\s+limit|out\s+of\s+memory/i.test(output)) {
    return { kind: "execution_error", verdict: "memory_limit", diagnostics, durationMs, cpuTime, memory };
  }
  if (/compil(?:e|ation).*(?:error|failed)|\berror\s*:/i.test(output)) {
    return { kind: "execution_error", verdict: "compile_error", diagnostics, durationMs, cpuTime, memory };
  }
  return { kind: "execution_error", verdict: "runtime_error", diagnostics, durationMs, cpuTime, memory };
}

export class JdoodleProvider implements ExecutionProvider {
  readonly configured: boolean;
  private readonly timeoutMs: number;
  private readonly fetch: Fetch;

  constructor(private readonly options: JdoodleOptions = {}) {
    this.configured = Boolean(options.clientId && options.clientSecret && options.javaVersionIndex && options.limitsConfirmed);
    this.timeoutMs = Math.min(30_000, Math.max(1_000, Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 15_000));
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  static fromEnvironment(): JdoodleProvider {
    return new JdoodleProvider({
      clientId: process.env.JDOODLE_CLIENT_ID,
      limitsConfirmed: process.env.JDOODLE_LIMITS_CONFIRMED === "true",
      clientSecret: process.env.JDOODLE_CLIENT_SECRET,
      javaVersionIndex: process.env.JDOODLE_JAVA_VERSION_INDEX,
      timeoutMs: process.env.JUDGE_REQUEST_TIMEOUT_MS
        ? Number(process.env.JUDGE_REQUEST_TIMEOUT_MS)
        : undefined,
    });
  }

  async execute(source: string): Promise<ExecutionResult> {
    if (!this.configured) {
      throw new ProviderFailure("unavailable", "JDoodle credentials and a confirmed Java version index are required.");
    }

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetch("https://api.jdoodle.com/v1/execute", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          clientId: this.options.clientId,
          clientSecret: this.options.clientSecret,
          script: source,
          language: "java",
          versionIndex: this.options.javaVersionIndex,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ProviderFailure("unavailable", "JDoodle did not respond before the broker deadline.");
    }
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));

    if (response.status === 429) {
      await response.body?.cancel();
      throw new ProviderFailure("quota_exhausted", "JDoodle rejected the request because its quota is exhausted.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderFailure("unavailable", `JDoodle returned HTTP ${response.status}.`);
    }

    let body: string;
    try {
      body = await readBounded(response, 65_536);
    } catch (error) {
      if (error instanceof ResponseTooLarge) {
        return {
          kind: "execution_error",
          verdict: "output_limit",
          diagnostics: "The external sandbox response exceeded LeetCollab's 64 KB response limit.",
          durationMs,
          cpuTime: null,
          memory: null,
        };
      }
      throw new ProviderFailure("unavailable", "JDoodle returned an unreadable response.");
    }

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new ProviderFailure("unavailable", "JDoodle returned malformed JSON.");
    }

    if (Number(payload.statusCode) === 429) {
      throw new ProviderFailure("quota_exhausted", "JDoodle reported that its quota is exhausted.");
    }

    if (payload.error || (payload.statusCode !== undefined && Number(payload.statusCode) !== 200)
      || typeof payload.output !== "string") {
      throw new ProviderFailure("unavailable", "JDoodle did not return a valid execution result.");
    }
    const output = payload.output;
    const cpuTime = stringField(payload.cpuTime);
    const memory = stringField(payload.memory);
    if (Buffer.byteLength(output, "utf8") > 16_384) {
      return {
        kind: "execution_error",
        verdict: "output_limit",
        diagnostics: "Program output exceeded LeetCollab's 16 KB output limit.",
        durationMs,
        cpuTime,
        memory,
      };
    }

    if (payload.isExecutionSuccess === false
      || /(?:^|\n)[^\n]*\.java:\d+: error:|Exception in thread|time\s+limit|timed\s*out|OutOfMemoryError/i.test(output)) {
      return executionFailure(output, durationMs, cpuTime, memory);
    }

    return { kind: "completed", output, durationMs, cpuTime, memory };
  }
}

export { readBounded };
