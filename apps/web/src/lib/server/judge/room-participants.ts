import { judgeParticipantSnapshotSchema } from "@leetcollab/contracts";
import { ProviderFailure, type SubmissionParticipants } from "./types";

function realtimeUrl(path: string): URL {
  const base = new URL(process.env.REALTIME_INTERNAL_URL?.trim() || process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))) throw new Error();
  return new URL(path, base);
}

export class RoomParticipationUnavailable extends ProviderFailure {
  constructor(expectedRoomId?: string) {
    super("unavailable", expectedRoomId
      ? "Reconnect to the room and confirm the current exercise before submitting. No execution was started."
      : "Room participation could not be verified. No execution was started.");
  }
}

export async function captureSubmissionParticipants(
  token: string, userId: string, problemId: string, expectedRoomId?: string, request: typeof fetch = fetch,
): Promise<SubmissionParticipants> {
  try {
    const url = realtimeUrl("/judge/participants");
    url.searchParams.set("problemId", problemId);
    if (expectedRoomId) url.searchParams.set("roomId", expectedRoomId);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text.length > 16_384) throw new Error();
    const snapshot = judgeParticipantSnapshotSchema.parse(JSON.parse(text));
    if (snapshot.problemId !== problemId || (expectedRoomId && snapshot.roomId !== expectedRoomId) || !snapshot.userIds.includes(userId)
      || new Set(snapshot.userIds).size !== snapshot.userIds.length
      || (snapshot.roomId === null && snapshot.userIds.length !== 1)) throw new Error();
    const { problemId: _problemId, ...participants } = snapshot;
    return participants;
  } catch {
    throw new RoomParticipationUnavailable(expectedRoomId);
  }
}

export async function notifyRoomCompletion(token: string, submissionId: string): Promise<void> {
  const response = await fetch(realtimeUrl("/judge/refresh"), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error("Completion refresh unavailable.");
}
