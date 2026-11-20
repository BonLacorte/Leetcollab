import { expect, it } from "vitest";
import type { RoomState } from "@leetcollab/contracts";
import { restoreRoomStates } from "../../../../../realtime/src/room-restore.js";

const actor = "11111111-1111-4111-8111-111111111111";
const state: RoomState = {
  roomId: "abcdefgh", hostUserId: actor, problem: null, code: "// unsaved live editor text",
  timer: { status: "running", elapsedMs: 1200, startedAt: "2026-11-18T08:00:00.000Z" },
  members: [{ userId: actor, username: "Actor", permissions: { canEditCode: true, canDrawWhiteboard: true, canChangeProblem: true, canChat: true } }],
  messages: [{ type: "system", id: "22222222-2222-4222-8222-222222222222", body: "Existing chat", sentAt: "2026-11-18T08:00:00.000Z" }],
  whiteboard: [{ id: "33333333-3333-4333-8333-333333333333", authorUserId: actor,
    tool: "pen", color: "#ffffff", size: 3, points: [{ x: 10, y: 12 }, { x: 20, y: 24 }] }],
};
it("restores exact code, room identity, members, timer, chat and whiteboard without persisting credentials", () => {
  expect(restoreRoomStates(JSON.stringify([state]))).toEqual([state]);
});
it("refuses malformed or conflicting state instead of silently dropping room contents", () => {
  expect(() => restoreRoomStates("{}")).toThrow();
  expect(() => restoreRoomStates(JSON.stringify([state, { ...state, roomId: "ijklmnop" }]))).toThrow("multiple rooms");
  expect(() => restoreRoomStates(JSON.stringify([{ ...state, members: [] }]))).toThrow("ownership");
});
