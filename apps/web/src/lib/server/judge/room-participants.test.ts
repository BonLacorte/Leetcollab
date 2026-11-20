import { afterEach, expect, it, vi } from "vitest";
import type { RoomState } from "@leetcollab/contracts";
import { judgeParticipants } from "../../../../../realtime/src/judge-participants.js";
import { captureSubmissionParticipants } from "./room-participants";

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
afterEach(() => vi.unstubAllEnvs());

it("captures unique live members synchronously; departures retain eligibility and later joins cannot join the snapshot", () => {
  const state = room();
  const snapshot = judgeParticipants(state, actor, problem, new Set([actor, peer]));
  state.members = [state.members[2]];
  expect(snapshot).toMatchObject({ roomId: "abcdefgh", userIds: [actor, peer] });
});

it("does not grant unrelated, disconnected or other-exercise members credit", () => {
  expect(judgeParticipants(room(), actor, problem, new Set([peer]))).toMatchObject({ roomId: null, userIds: [actor] });
  expect(judgeParticipants(room(), actor, late, new Set([actor, peer]))).toMatchObject({ roomId: null, userIds: [actor] });
  expect(judgeParticipants(null, actor, problem, new Set())).toMatchObject({ roomId: null, userIds: [actor] });
});

it("uses only the configured authenticated realtime authority, not client-supplied member IDs", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "http://127.0.0.1:3201");
  const snapshot = { problemId: problem, roomId: "abcdefgh", capturedAt: new Date().toISOString(), userIds: [actor, peer] };
  const request = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify(snapshot)));
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, request)).resolves.toEqual({
    roomId: snapshot.roomId, capturedAt: snapshot.capturedAt, userIds: [actor, peer],
  });
  expect(String(request.mock.calls[0][0])).toBe(`http://127.0.0.1:3201/judge/participants?problemId=${problem}`);
  expect(request.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer synthetic-token" }, redirect: "error" });
});

it("uses the public socket origin when the optional internal URL is blank", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "http://localhost:3201");
  const request = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({
    problemId: problem, roomId: null, capturedAt: new Date().toISOString(), userIds: [actor],
  })));
  await captureSubmissionParticipants("synthetic-token", actor, problem, request);
  expect(String(request.mock.calls[0][0])).toBe(`http://localhost:3201/judge/participants?problemId=${problem}`);
});

it.each([
  { problemId: late, roomId: "abcdefgh", userIds: [actor, peer] },
  { problemId: problem, roomId: null, userIds: [actor, peer] },
  { problemId: problem, roomId: "abcdefgh", userIds: [peer] },
  { problemId: problem, roomId: "abcdefgh", userIds: [actor, actor] },
])("refuses ambiguous or unrelated snapshots before execution", async fields => {
  const request = vi.fn(async () => new Response(JSON.stringify({ ...fields, capturedAt: new Date().toISOString() })));
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, request)).rejects.toThrow("No execution was started");
});

it("never sends credentials to a client URL or insecure remote realtime target", async () => {
  vi.stubEnv("REALTIME_INTERNAL_URL", "http://untrusted.example");
  const request = vi.fn();
  await expect(captureSubmissionParticipants("synthetic-token", actor, problem, request)).rejects.toThrow("No execution was started");
  expect(request).not.toHaveBeenCalled();
});
