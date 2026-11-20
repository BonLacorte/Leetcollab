import type { RoomState } from "@leetcollab/contracts";

/** Synchronous snapshot: callers derive presence from authenticated joined sockets. */
export function judgeParticipants(
  room: RoomState | null, userId: string, problemId: string, presentUserIds: ReadonlySet<string>,
  capturedAt = new Date().toISOString(),
) {
  const eligible = room?.problem?.id === problemId && presentUserIds.has(userId)
    && room.members.some(member => member.userId === userId);
  const userIds = eligible ? [...new Set(room.members.filter(member => presentUserIds.has(member.userId)).map(member => member.userId))] : [userId];
  return { problemId, roomId: eligible ? room.roomId : null, capturedAt, userIds };
}
