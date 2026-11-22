import { judgeParticipantSnapshotSchema } from "@leetcollab/contracts";
import { ProviderFailure, type SubmissionParticipants } from "./types";

function realtimeUrl(path: string): URL {
  const base = new URL(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))) throw new Error();
  return new URL(path, base);
}

function judgeHeaders(token: string) {
  const secret = process.env.REALTIME_JUDGE_SHARED_SECRET?.trim();
  if (!secret) throw new Error("Realtime judge credential is missing.");
  return { Authorization: `Bearer ${token}`, "X-Realtime-Judge-Secret": secret };
}

export class RoomParticipationUnavailable extends ProviderFailure {
  constructor() {
    super("unavailable", "Reconnect to the room and confirm the current exercise before submitting. No execution was started.");
  }
}

export async function captureSubmissionParticipants(
  token: string, userId: string, problemId: string, expectedRoomId: string, request: typeof fetch = fetch,
): Promise<SubmissionParticipants> {
  try {
    const url = realtimeUrl("/judge/participants");
    url.searchParams.set("problemId", problemId);
    url.searchParams.set("roomId", expectedRoomId);
    const response = await request(url, {
      headers: judgeHeaders(token),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text.length > 16_384) throw new Error();
    const snapshot = judgeParticipantSnapshotSchema.parse(JSON.parse(text));
    if (snapshot.problemId !== problemId || snapshot.roomId !== expectedRoomId || !snapshot.userIds.includes(userId)
      || new Set(snapshot.userIds).size !== snapshot.userIds.length) throw new Error();
    const { problemId: _problemId, ...participants } = snapshot;
    return participants;
  } catch {
    throw new RoomParticipationUnavailable();
  }
}

export async function notifyRoomCompletion(token: string, submissionId: string): Promise<void> {
  const response = await fetch(realtimeUrl("/judge/refresh"), {
    method: "POST", headers: { ...judgeHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error("Completion refresh unavailable.");
}
