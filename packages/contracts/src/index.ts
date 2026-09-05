import { z } from "zod";

export const acknowledgementSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export type Acknowledgement<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?: RoomErrorCode;
      currentRoomId?: string;
    };

export const whiteboardPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export type WhiteboardPoint = z.infer<typeof whiteboardPointSchema>;

export const whiteboardToolSchema = z.enum(["pen", "eraser"]);

export type WhiteboardTool = z.infer<typeof whiteboardToolSchema>;

export const whiteboardStrokeInputSchema = z.object({
  tool: whiteboardToolSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  size: z.number().int().min(1).max(48),
  points: z.array(whiteboardPointSchema).min(1).max(2_000),
});

export type WhiteboardStrokeInput = z.infer<typeof whiteboardStrokeInputSchema>;

export const whiteboardStrokeSchema = whiteboardStrokeInputSchema.extend({
  id: z.string().uuid(),
  authorUserId: z.string().uuid(),
});

export type WhiteboardStroke = z.infer<typeof whiteboardStrokeSchema>;

export const problemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  category: z.string(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  sortOrder: z.number().int(),
  statement: z.string(),
  starterCode: z.string(),
  examples: z.array(z.object({
    title: z.string(),
    input: z.string(),
    output: z.string(),
    explanation: z.string().optional(),
  })),
  constraints: z.array(z.string()),
});

export type Problem = z.infer<typeof problemSchema>;

export const solvedWithMemberSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
});

export type SolvedWithMember = z.infer<typeof solvedWithMemberSchema>;

export const problemProgressSchema = z.object({
  userId: z.string().uuid(),
  problemId: z.string().uuid(),
  draftCode: z.string(),
  draftLanguage: z.string(),
  lastSavedAt: z.string().datetime().nullable(),
  solvedAt: z.string().datetime().nullable(),
  solvedWith: z.array(solvedWithMemberSchema),
  solvedCode: z.string().nullable(),
});

export type ProblemProgress = z.infer<typeof problemProgressSchema>;

export const timerSchema = z.object({
  status: z.enum(["idle", "running", "paused"]),
  elapsedMs: z.number().int().min(0),
  startedAt: z.string().datetime().nullable(),
});

export type RoomTimer = z.infer<typeof timerSchema>;

export const roomPermissionsSchema = z.object({
  canEditCode: z.boolean(),
  canDrawWhiteboard: z.boolean(),
  canChangeProblem: z.boolean(),
  canChat: z.boolean(),
})

export type RoomPermissions = z.infer<typeof roomPermissionsSchema>;

export const roomMemberSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  permissions: roomPermissionsSchema,
});

export type RoomMember = z.infer<typeof roomMemberSchema>;

export const roomStateSchema = z.object({
  roomId: z.string().uuid(),
  hostUserId: z.string().uuid(),
  problem: problemSchema.nullable(),
  code: z.string(),
  timer: timerSchema,
  members: z.array(roomMemberSchema),
  messages: z.array(z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    username: z.string(),
    body: z.string(),
    sentAt: z.string(),
  })),
  whiteboard: z.array(whiteboardStrokeSchema),
});

export type RoomState = z.infer<typeof roomStateSchema>;

export const createRoomSchema = z.object({
  roomId: z.string().uuid().optional(),
  problemId: z.string().uuid(),
});
export const roomIdSchema = z.object({ roomId: z.string().uuid() });
export const setProblemSchema = roomIdSchema.extend({ problemId: z.string().uuid() });
export const codeUpdateSchema = roomIdSchema.extend({ code: z.string().max(100_000) });
export const chatSendSchema = roomIdSchema.extend({ body: z.string().trim().min(1).max(2_000) });
export const whiteboardStrokeAddSchema = roomIdSchema.extend({ stroke: whiteboardStrokeInputSchema });
export const whiteboardUndoSchema = roomIdSchema;
export const timerActionSchema = roomIdSchema;

export const setMemberPermissionsSchema = roomIdSchema.extend({
  memberUserId: z.string().uuid(),
  permissions: roomPermissionsSchema,
});

export type RoomErrorCode =
  | "ALREADY_IN_ROOM"
  | "ROOM_NOT_FOUND"
  | "FORBIDDEN";

export interface ClientToServerEvents {
  "room:create": (payload: z.infer<typeof createRoomSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "room:join": (payload: z.infer<typeof roomIdSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "room:leave": (payload: z.infer<typeof roomIdSchema>, callback: (response: Acknowledgement<null>) => void) => void;
  "room:problem:set": (payload: z.infer<typeof setProblemSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "room:timer:start": (payload: z.infer<typeof timerActionSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "room:timer:pause": (payload: z.infer<typeof timerActionSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "room:timer:reset": (payload: z.infer<typeof timerActionSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "code:update": (payload: z.infer<typeof codeUpdateSchema>) => void;
  "chat:send": (payload: z.infer<typeof chatSendSchema>, callback: (response: Acknowledgement<null>) => void) => void;
  "whiteboard:stroke:add": (
    payload: z.infer<typeof whiteboardStrokeAddSchema>,
    callback: (response: Acknowledgement<WhiteboardStroke>) => void,
  ) => void;
  "whiteboard:undo": (
    payload: z.infer<typeof whiteboardUndoSchema>,
    callback: (response: Acknowledgement<{ strokeId: string }>) => void,
  ) => void;
  "whiteboard:clear": (payload: z.infer<typeof roomIdSchema>, callback: (response: Acknowledgement<null>) => void) => void;
  "room:current": (
  callback: (response: Acknowledgement<{ roomId: string } | null>) => void,
  ) => void;

  "room:member:permissions:set": (
    payload: z.infer<typeof setMemberPermissionsSchema>,
    callback: (response: Acknowledgement<RoomState>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "room:presence": (members: RoomState["members"]) => void;
  "code:updated": (code: string) => void;
  "chat:message": (message: RoomState["messages"][number]) => void;
  "whiteboard:stroke:added": (stroke: WhiteboardStroke) => void;
  "whiteboard:undone": (payload: { strokeId: string }) => void;
  "whiteboard:cleared": () => void;
  "room:left": (payload: {
    roomId: string;
    reason: "left" | "room-ended";
  }) => void;

}
