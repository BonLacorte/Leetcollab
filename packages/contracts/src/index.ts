import { z } from "zod";

export const acknowledgementSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export type Acknowledgement<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  size: z.number().int().min(1).max(32),
  isNewStroke: z.boolean(),
});

export type WhiteboardPoint = z.infer<typeof pointSchema>;

export const problemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
});

export type Problem = z.infer<typeof problemSchema>;

export const roomStateSchema = z.object({
  roomId: z.string().uuid(),
  hostUserId: z.string().uuid(),
  problem: problemSchema.nullable(),
  code: z.string(),
  members: z.array(z.object({ userId: z.string().uuid(), username: z.string() })),
  messages: z.array(z.object({ id: z.string().uuid(), username: z.string(), body: z.string(), sentAt: z.string() })),
  whiteboard: z.array(pointSchema),
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
export const whiteboardDrawSchema = roomIdSchema.extend({ point: pointSchema });

export interface ClientToServerEvents {
  "room:create": (payload: z.infer<typeof createRoomSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "room:join": (payload: z.infer<typeof roomIdSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "room:leave": (payload: z.infer<typeof roomIdSchema>, callback: (response: Acknowledgement<null>) => void) => void;
  "room:problem:set": (payload: z.infer<typeof setProblemSchema>, callback: (response: Acknowledgement<RoomState>) => void) => void;
  "code:update": (payload: z.infer<typeof codeUpdateSchema>) => void;
  "chat:send": (payload: z.infer<typeof chatSendSchema>, callback: (response: Acknowledgement<null>) => void) => void;
  "whiteboard:draw": (payload: z.infer<typeof whiteboardDrawSchema>) => void;
  "whiteboard:clear": (payload: z.infer<typeof roomIdSchema>, callback: (response: Acknowledgement<null>) => void) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "room:presence": (members: RoomState["members"]) => void;
  "code:updated": (code: string) => void;
  "chat:message": (message: RoomState["messages"][number]) => void;
  "whiteboard:drew": (point: WhiteboardPoint) => void;
  "whiteboard:cleared": () => void;
}

