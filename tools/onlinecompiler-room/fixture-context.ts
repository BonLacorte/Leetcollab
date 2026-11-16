import { constants, openSync, fstatSync, readFileSync, closeSync, writeFileSync, existsSync } from "node:fs";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "../supabase-admin";
import { executeOnlineCompilerProgram } from "./onlinecompiler";
import { buildJavaProgram } from "./safety";
import { JudgeService } from "./service";
import { SupabaseJudgeRepository } from "./supabase-repository";
import type { ExecutionProvider } from "./types";

const problemId = "11111111-1111-4111-8111-111111111142";
const roomId = "ocdemo01";
const harness = "class Main { public static void main(String[] args) { System.out.println(Solution.answer()); } }";
const sources = [
  "class Solution { static int answer() { return 41; } }",
  "class Solution { static int answer() { return 42; } }",
];
const root = process.env.OC_ROOM_ROOT!;
const ownerId = process.env.OC_OWNER_ID!;
if (!root || !ownerId || process.env.NODE_ENV === "production"
  || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:58550"
  || process.env.NEXT_PUBLIC_SOCKET_URL !== "http://127.0.0.1:3321") throw new Error("Isolated fixture runtime required");

function attemptNumber() {
  if (existsSync(`${root}/attempt-2.json`)) throw new Error("Fixture allowance spent");
  return existsSync(`${root}/attempt-1.json`) ? 1 : 0;
}

function readKey() {
  const fd = openSync("/home/costa/firstmate/config/private/leetcollab/onlinecompiler.env", constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0 || stat.size > 16384) throw new Error("Private handoff checks failed");
    const entries = readFileSync(fd, "utf8").split(/\r?\n/).filter(line => line.startsWith("ONLINECOMPILER_API_KEY="));
    if (entries.length !== 1) throw new Error("Private handoff parsing failed");
    let key = entries[0].slice("ONLINECOMPILER_API_KEY=".length).trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw new Error("Private handoff parsing failed");
    return key;
  } finally { closeSync(fd); }
}

async function usage(key: string, expectedUsed: number) {
  const response = await fetch("https://api.onlinecompiler.io/api/usage/", {
    headers: { authorization: key }, redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store",
  });
  if (response.status !== 200 || !response.body) throw new Error("Allowance unavailable");
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65536) throw new Error("Allowance response too large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (data.monthly_limit !== 100000 || data.submissions !== expectedUsed || data.remaining !== 100000 - expectedUsed || data.remaining < 2 - (expectedUsed - 3)) throw new Error("Unexpected free allowance");
  return { submissions: data.submissions, monthly_limit: data.monthly_limit, remaining: data.remaining };
}

const provider: ExecutionProvider = {
  id: "onlinecompiler", configured: true,
  async execute(program) {
    const index = attemptNumber();
    if (program !== buildJavaProgram(sources[index], harness)) throw new Error("Unreviewed assembled fixture");
    const key = readKey();
    const allowance = await usage(key, 3 + index);
    const path = `${root}/attempt-${index + 1}.json`;
    const record = { fixture: index === 0 ? "wrong-answer Run" : "passing Submit", state: "attempted; outcome pending", usageBefore: allowance, startedAt: new Date().toISOString() };
    const fd = openSync(path, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(record)); } finally { closeSync(fd); }
    try {
      const result = await executeOnlineCompilerProgram(program, key, 30000);
      const expected = result.kind === "completed" && result.output === (index === 0 ? "41\n" : "42\n");
      writeFileSync(path, JSON.stringify({ ...record, state: expected ? "expected provider output; persistence pending" : "unexpected outcome; stop", kind: result.kind, durationMs: result.durationMs }));
      if (!expected) throw new Error("Unexpected fixture output");
      return result;
    } catch {
      writeFileSync(path, JSON.stringify({ ...record, state: "failed or ambiguous; stop without retry" }));
      throw new Error("Fixture execution stopped");
    }
  },
};

class FixtureService extends JudgeService {
  async submit(userId: string, request: Parameters<JudgeService["submit"]>[1]) {
    const index = attemptNumber();
    const referer = (await headers()).get("referer");
    if (userId !== ownerId || request.problemId !== problemId || request.sourceCode !== sources[index]
      || referer !== `http://127.0.0.1:3320/room/${roomId}`) throw new Error("Unreviewed fixture context");
    const admin = getSupabaseAdmin();
    const config = await new SupabaseJudgeRepository(admin).getConfig(problemId);
    if (!config || config.fixtureVersion !== 1 || config.harnessSource !== harness
      || JSON.stringify(config.expectedOutput) !== '["42"]') throw new Error("Fixture config changed");
    const { data, error } = await admin.from("submissions").select("user_id, problem_id, judge_state, verdict, tests_passed, tests_total");
    if (error || !data || data.length !== index || data.some(row => row.user_id !== ownerId || row.problem_id !== problemId
      || row.judge_state !== "completed" || row.verdict !== "wrong_answer" || row.tests_passed !== 0 || row.tests_total !== 1)) throw new Error("Unexpected prior persistence");
    if (index === 1) {
      const previous = JSON.parse(readFileSync(`${root}/attempt-1.json`, "utf8"));
      if (previous.state !== "persisted wrong_answer") throw new Error("Previous attempt incomplete");
    }
    const result = await super.submit(userId, request);
    const path = `${root}/attempt-${index + 1}.json`;
    if (existsSync(path)) {
      const previous = JSON.parse(readFileSync(path, "utf8"));
      const expected = result.body.ok && result.body.submission.verdict === (index === 0 ? "wrong_answer" : "accepted");
      writeFileSync(path, JSON.stringify({ ...previous, state: expected ? `persisted ${index === 0 ? "wrong_answer" : "accepted"}` : "unexpected persistence; stop" }));
    }
    return result;
  }
}

export function getJudgeService() {
  return new FixtureService(new SupabaseJudgeRepository(getSupabaseAdmin()), provider);
}
