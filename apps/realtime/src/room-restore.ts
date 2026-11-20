import { z } from "zod";
import { roomStateSchema, type RoomState } from "@leetcollab/contracts";

/** Explicit operator handoff only; never accepts a client-uploaded room file. */
export function restoreRoomStates(serialized: string): RoomState[] {
  const rooms = z.array(roomStateSchema).parse(JSON.parse(serialized));
  const roomIds = new Set<string>();
  const users = new Set<string>();
  for (const room of rooms) {
    if (roomIds.has(room.roomId) || !room.members.some(member => member.userId === room.hostUserId)) {
      throw new Error("Invalid restored room ownership.");
    }
    roomIds.add(room.roomId);
    for (const member of room.members) {
      if (users.has(member.userId)) throw new Error("A restored member belongs to multiple rooms.");
      users.add(member.userId);
    }
  }
  return rooms;
}
