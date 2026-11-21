import { setTimeout } from "node:timers/promises";
import type { RoomState } from "@leetcollab/contracts";

export function judgeParticipants(
  room: RoomState | null, userId: string, problemId: string, presentUserIds: ReadonlySet<string>,
  expectedRoomId?: string, capturedAt = new Date().toISOString(),
) {
  if (expectedRoomId && (room?.roomId !== expectedRoomId || room.problem?.id !== problemId)) return null;
  if (room?.problem?.id === problemId) {
    if (!presentUserIds.has(userId) || !room.members.some(member => member.userId === userId)) return null;
    const userIds = [...new Set(room.members.filter(member => presentUserIds.has(member.userId)).map(member => member.userId))];
    return { problemId, roomId: room.roomId, capturedAt, userIds };
  }
  return { problemId, roomId: null, capturedAt, userIds: [userId] };
}

export async function waitForJudgeParticipants(capture: () => ReturnType<typeof judgeParticipants>) {
  let snapshot = capture();
  for (let remaining = 10; !snapshot && remaining > 0; remaining--) {
    await setTimeout(100);
    snapshot = capture();
  }
  return snapshot;
}
