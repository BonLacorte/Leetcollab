import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RoomState } from "@leetcollab/contracts";
import { judgeParticipants, waitForJudgeParticipants } from "../../../../../realtime/src/judge-participants.js";
import { captureSubmissionParticipants, notifyRoomCompletion } from "./room-participants";

const actor = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
const late = "33333333-3333-4333-8333-333333333333";
const problem = "44444444-4444-4444-8444-444444444444";
const room = (): RoomState => ({ roomId: "abcdefgh", hostUserId: actor,
  problem: { id: problem, slug: "test", title: "Test", category: "Arrays", difficulty: "Easy", sortOrder: 1,
    statement: "", starterCode: "", examples: [], constraints: [] }, code: "",
  timer: { status: "idle", elapsedMs: 0, startedAt: null }, messages: [], whiteboard: [],
  members: [actor, peer, late].map(userId => ({ userId, username: userId,
    permissions: { canEditCode: true, canDrawWhiteboard: true, canChangeProblem: false, canChat: true } })),
});
beforeEach(() => vi.stubEnv("REALTIME_JUDGE_SHARED_SECRET", "synthetic-capture-secret"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("captures unique live members synchronously; departures retain eligibility and later joins cannot join the snapshot", () => {
  const state = room();
  const snapshot = judgeParticipants(state, actor, problem, new Set([actor, peer]));
  state.members = [state.members[2]];
  expect(snapshot).toMatchObject({ roomId: "abcdefgh", userIds: [actor, peer] });
});

it("does not grant unrelated, disconnected or other-exercise members credit", () => {
  expect(judgeParticipants(room(), actor, problem, new Set([peer]))).toBeNull();
  expect(judgeParticipants(room(), actor, late, new Set([actor, peer]))).toMatchObject({ roomId: null, userIds: [actor] });
  expect(judgeParticipants(null, actor, problem, new Set())).toMatchObject({ roomId: null, userIds: [actor] });
});

it("waits for the actor to rejoin and captures only live room members", async () => {
  const present = new Set([peer]);
  const result = waitForJudgeParticipants(() => judgeParticipants(room(), actor, problem, present, "abcdefgh"));
  expect(judgeParticipants(null, actor, problem, present, "abcdefgh")).toBeNull();
  expect(judgeParticipants(room(), actor, late, present, "abcdefgh")).toBeNull();
  present.add(actor);
  await expect(result).resolves.toMatchObject({ roomId: "abcdefgh", userIds: [actor, peer] });
});

it("refuses actor-only fallback for a room Submit with reconnect feedback", async () => {
  const request = vi.fn(async () => new Response(JSON.stringify({
    problemId: problem, roomId: null, userIds: [actor],
  })));
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, "abcdefgh", request))
    .rejects.toThrow("Reconnect to the room");
});

it("uses only the configured authenticated realtime authority, not client-supplied member IDs", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "http://127.0.0.1:3201");
  const snapshot = { problemId: problem, roomId: "abcdefgh", userIds: [actor, peer] };
  const request = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify(snapshot)));
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, "abcdefgh", request)).resolves.toEqual({
    roomId: snapshot.roomId, userIds: [actor, peer],
  });
  expect(String(request.mock.calls[0][0])).toBe(`http://127.0.0.1:3201/judge/participants?problemId=${problem}&roomId=abcdefgh`);
  expect(request.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer synthetic-token", "X-Realtime-Judge-Secret": "synthetic-capture-secret" }, redirect: "error" });
});

it("uses the public socket origin when the optional internal URL is blank", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "http://localhost:3201");
  const request = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({
    problemId: problem, roomId: null, userIds: [actor],
  })));
  await captureSubmissionParticipants("synthetic-token", actor, problem, undefined, request);
  expect(String(request.mock.calls[0][0])).toBe(`http://localhost:3201/judge/participants?problemId=${problem}`);
});

it.each([
  { problemId: late, roomId: "abcdefgh", userIds: [actor, peer] },
  { problemId: problem, roomId: null, userIds: [actor, peer] },
  { problemId: problem, roomId: "abcdefgh", userIds: [peer] },
  { problemId: problem, roomId: "abcdefgh", userIds: [actor, actor] },
])("refuses ambiguous or unrelated snapshots before execution", async fields => {
  const request = vi.fn(async () => new Response(JSON.stringify(fields)));
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, undefined, request)).rejects.toThrow("No execution was started");
});

it("never sends credentials to a client URL or insecure remote realtime target", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "http://untrusted.example");
  const request = vi.fn();
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, undefined, request)).rejects.toThrow("No execution was started");
  expect(request).not.toHaveBeenCalled();
});

it("does not call the realtime authority without the server credential", async () => {
  vi.stubEnv("REALTIME_JUDGE_SHARED_SECRET", "");
  const request = vi.fn();
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, undefined, request)).rejects.toThrow("No execution was started");
  expect(request).not.toHaveBeenCalled();
});

it("sends the server credential and actor token only to the configured solve refresh endpoint", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "http://127.0.0.1:3201");
  const request = vi.fn(async (_url: URL, _options: RequestInit) => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", request);
  await notifyRoomCompletion("synthetic-token", problem);
  expect(String(request.mock.calls[0][0])).toBe("http://127.0.0.1:3201/judge/refresh");
  expect(request.mock.calls[0][1]).toMatchObject({
    method: "POST", redirect: "error", headers: { Authorization: "Bearer synthetic-token", "X-Realtime-Judge-Secret": "synthetic-capture-secret" },
    body: JSON.stringify({ submissionId: problem }),
  });
  vi.stubEnv("REALTIME_JUDGE_SHARED_SECRET", "");
  await expect(notifyRoomCompletion("synthetic-token", problem)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
