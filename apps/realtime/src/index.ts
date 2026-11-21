import "dotenv/config";
import http from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import { judgeParticipants, waitForJudgeParticipants } from "./judge-participants.js";
import {
  chatSendSchema,
  codeUpdateSchema,
  codeReplaceSchema,
  createRoomSchema,
  roomIdSchema,
  setMemberPermissionsSchema,
  setProblemSchema,
  timerActionSchema,
  whiteboardStrokeAddSchema,
  whiteboardUndoSchema,
  judgeSubmissionRequestSchema,
  type RoomErrorCode,
  type RoomPermissions,
  type Acknowledgement,
  type ClientToServerEvents,
  type Problem,
  type RoomTimer,
  type RoomState,
  type ServerToClientEvents,
  type WhiteboardStroke,
} from "@leetcollab/contracts";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const origin = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map(value => value.trim());
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const judgeSharedSecret = process.env.REALTIME_JUDGE_SHARED_SECRET?.trim();
const judgeSecretHash = judgeSharedSecret ? createHash("sha256").update(judgeSharedSecret).digest() : null;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const supabaseAdmin = supabaseServiceRoleKey ? createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;
const app = express();
app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.get("/health", (_request, response) => response.json({ ok: true }));

type SocketData = { userId: string; username: string; token: string };
type Room = RoomState;
type ProblemExample = Problem["examples"][number];
const rooms = new Map<string, Room>();
const activeRoomByUser = new Map<string, string>();
const socketIdsByUser = new Map<string, Set<string>>();
const maxWhiteboardStrokes = 2_000;
const roomIdAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(server, {
  cors: { origin, methods: ["GET", "POST"], credentials: true },
});

const success = <T>(data: T): Acknowledgement<T> => ({ ok: true, data });
const failure = <T = never>(
  error: string,
  code?: RoomErrorCode,
  currentRoomId?: string,
): Acknowledgement<T> => ({
  ok: false,
  error,
  ...(code ? { code } : {}),
  ...(currentRoomId ? { currentRoomId } : {}),
});

function activeRoomForUser(userId: string): Room | null {
  const roomId = activeRoomByUser.get(userId);
  if (!roomId) return null;

  const room = rooms.get(roomId);
  if (!room) {
    activeRoomByUser.delete(userId);
    return null;
  }

  return room;
}

app.get("/judge/participants", async (request, response) => {
  response.set("Cache-Control", "no-store");
  const secret = request.header("x-realtime-judge-secret");
  if (!judgeSecretHash || !secret || !timingSafeEqual(createHash("sha256").update(secret).digest(), judgeSecretHash)) {
    return void response.status(401).json({ error: "Authentication required." });
  }
  const token = /^Bearer ([^\s]+)$/.exec(request.header("authorization") ?? "")?.[1];
  if (!token) return void response.status(401).json({ error: "Authentication required." });
  const parsed = judgeSubmissionRequestSchema.shape.problemId.safeParse(request.query.problemId);
  const expectedRoom = judgeSubmissionRequestSchema.shape.roomId.safeParse(request.query.roomId);
  if (!parsed.success || !expectedRoom.success) return void response.status(400).json({ error: "Invalid participation request." });
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return void response.status(401).json({ error: "Authentication required." });
    const userId = data.user.id;
    const snapshot = await waitForJudgeParticipants(() => {
      const room = activeRoomForUser(userId);
      const joined = io.sockets.adapter.rooms.get(room?.roomId ?? "");
      const present = new Set((room?.members ?? []).filter(member =>
        [...(socketIdsByUser.get(member.userId) ?? [])].some(id => joined?.has(id))).map(member => member.userId));
      return judgeParticipants(room, userId, parsed.data, present, expectedRoom.data);
    });
    if (!snapshot) return void response.status(409).json({ error: "Reconnect to the current room and exercise before submitting." });
    return void response.json(snapshot);
  } catch {
    return void response.status(503).json({ error: "Room participation unavailable." });
  }
});

app.post("/judge/refresh", express.json({ limit: "2kb" }), async (request, response) => {
  response.set("Cache-Control", "no-store");
  const token = /^Bearer ([^\s]+)$/.exec(request.header("authorization") ?? "")?.[1];
  if (!token) return void response.status(401).json({ error: "Authentication required." });
  const parsed = judgeSubmissionRequestSchema.shape.idempotencyKey.safeParse(request.body?.submissionId);
  if (!parsed.success) return void response.status(400).json({ error: "Invalid submission." });
  try {
    const { data: identity, error: authError } = await supabase.auth.getUser(token);
    if (authError || !identity.user) return void response.status(401).json({ error: "Authentication required." });
    if (!supabaseAdmin) return void response.status(503).json({ error: "Completion refresh unavailable." });
    const { data, error } = await supabaseAdmin.rpc("judge_refresh_recipients", {
      p_submission_id: parsed.data, p_actor_id: identity.user.id,
    });
    if (error) throw error;
    for (const { user_id, room_id, problem_id } of data ?? []) {
      const joined = io.sockets.adapter.rooms.get(room_id);
      for (const socketId of socketIdsByUser.get(user_id) ?? []) {
        if (joined?.has(socketId)) io.to(socketId).emit("practice:refresh", { problemId: problem_id });
      }
    }
    return void response.status(202).json({ ok: true });
  } catch { return void response.status(503).json({ error: "Completion refresh unavailable." }); }
});

function memberCan(
  room: Room,
  userId: string,
  capability: keyof RoomPermissions,
): boolean {
  if (room.hostUserId === userId) return true;

  return room.members.find((member) => member.userId === userId)
    ?.permissions[capability] === true;
}

function registerSocket(userId: string, socketId: string): void {
  const socketIds = socketIdsByUser.get(userId) ?? new Set<string>();
  socketIds.add(socketId);
  socketIdsByUser.set(userId, socketIds);
}

function unregisterSocket(userId: string, socketId: string): void {
  const socketIds = socketIdsByUser.get(userId);
  if (!socketIds) return;

  socketIds.delete(socketId);
  if (socketIds.size === 0) socketIdsByUser.delete(userId);
}


function hostPermissions(): RoomPermissions {
  return {
    canEditCode: true,
    canDrawWhiteboard: true,
    canChangeProblem: true,
    canChat: true,
  };
}

function participantPermissions(): RoomPermissions {
  return {
    canEditCode: true,
    canDrawWhiteboard: true,
    canChangeProblem: false,
    canChat: true,
  };
}

function initialTimer(): RoomTimer {
  return {
    status: "idle",
    elapsedMs: 0,
    startedAt: null,
  };
}

function elapsedTimerMs(timer: RoomTimer, now = Date.now()): number {
  if (timer.status !== "running" || !timer.startedAt) return timer.elapsedMs;
  return timer.elapsedMs + Math.max(0, now - Date.parse(timer.startedAt));
}

function hostOnlyTimerAction(
  room: Room,
  userId: string,
): Acknowledgement<never> | null {
  return room.hostUserId === userId
    ? null
    : failure("Only the room host can control the timer.", "FORBIDDEN");
}

function roomForMember(roomId: string, userId: string): Room | undefined {
  const room = rooms.get(roomId);
  return room?.members.some((member) => member.userId === userId) ? room : undefined;
}

function broadcastState(room: Room): void {
  io.to(room.roomId).emit("room:state", room);
  io.to(room.roomId).emit("room:presence", room.members);
}

function generateRoomId(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => roomIdAlphabet[byte % roomIdAlphabet.length]).join("");
}

function generateUniqueRoomId(): string {
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const roomId = generateRoomId();
    if (!rooms.has(roomId)) return roomId;
  }

  throw new Error("Could not generate a unique room ID.");
}

function appendSystemMessage(room: Room, body: string): void {
  const message: RoomState["messages"][number] = {
    type: "system",
    id: randomUUID(),
    body,
    sentAt: new Date().toISOString(),
  };

  room.messages.push(message);
  io.to(room.roomId).emit("chat:message", message);
}

function requirePermission(
  room: Room,
  userId: string,
  capability: keyof RoomPermissions,
  message: string,
): Acknowledgement<never> | null {
  return memberCan(room, userId, capability) ? null : failure(message, "FORBIDDEN");
}

async function getProblem(problemId: string, token: string): Promise<Problem | null> {
  const client = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client
    .from("problems")
    .select("id, slug, title, category, difficulty, sort_order, statement, starter_code, examples, constraints")
    .eq("id", problemId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    category: data.category,
    difficulty: data.difficulty,
    sortOrder: data.sort_order,
    statement: data.statement,
    starterCode: data.starter_code,
    examples: Array.isArray(data.examples) ? data.examples as ProblemExample[] : [],
    constraints: Array.isArray(data.constraints) ? data.constraints as string[] : [],
  } as Problem;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string") return next(new Error("Authentication is required."));

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return next(new Error("Invalid or expired session."));

  socket.data.token = token;
  socket.data.userId = data.user.id;
  socket.data.username = typeof data.user.user_metadata.username === "string"
    ? data.user.user_metadata.username
    : data.user.email?.split("@")[0] ?? "coder";
  next();
});

io.on("connection", (socket) => {
  registerSocket(socket.data.userId, socket.id);

  socket.on("disconnect", () => {
    unregisterSocket(socket.data.userId, socket.id);
  });
  socket.on("room:create", async (payload, callback) => {
    const currentRoom = activeRoomForUser(socket.data.userId);
    if (currentRoom) {
      return callback(failure(
        "Leave your current room before creating another one.",
        "ALREADY_IN_ROOM",
        currentRoom.roomId,
      ));
    }

    const parsed = createRoomSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room creation request."));
    const problem = await getProblem(parsed.data.problemId, socket.data.token);
    if (!problem) return callback(failure("Problem not found."));

    const roomId = parsed.data.roomId ?? generateUniqueRoomId();
    if (rooms.has(roomId)) return callback(failure("Room already exists."));

    const room: Room = {
      roomId,
      hostUserId: socket.data.userId,
      problem,
      code: problem.starterCode,
      timer: initialTimer(),
      members: [{
        userId: socket.data.userId,
        username: socket.data.username,
        permissions: hostPermissions(),
      }],
      messages: [],
      whiteboard: [],
    };
    rooms.set(roomId, room);
    activeRoomByUser.set(socket.data.userId, roomId);

    socket.join(roomId);
    callback(success(room));
  });

  socket.on("room:join", (payload, callback) => {
    const parsed = roomIdSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room ID."));

    const currentRoom = activeRoomForUser(socket.data.userId);
    if (currentRoom && currentRoom.roomId !== parsed.data.roomId) {
      return callback(failure(
        "Leave your current room before joining another one.",
        "ALREADY_IN_ROOM",
        currentRoom.roomId,
      ));
    }

    const room = rooms.get(parsed.data.roomId);
    if (!room) {
      return callback(failure("Room not found or has ended.", "ROOM_NOT_FOUND"));
    }

    if (!room.members.some((member) => member.userId === socket.data.userId)) {
      room.members.push({
        userId: socket.data.userId,
        username: socket.data.username,
        permissions: participantPermissions(),
      });
    }

    activeRoomByUser.set(socket.data.userId, room.roomId);
    socket.join(room.roomId);
    broadcastState(room);
    callback(success(room));
  });

  socket.on("room:current", (callback) => {
    const room = activeRoomForUser(socket.data.userId);
    callback(success(room ? { roomId: room.roomId } : null));
  });

  socket.on("room:leave", (payload, callback) => {
    const parsed = roomIdSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room ID."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const leavingUsername = room.members.find((member) => member.userId === socket.data.userId)?.username
      ?? socket.data.username;
    const wasHost = room.hostUserId === socket.data.userId;

    room.members = room.members.filter((member) => member.userId !== socket.data.userId);

    activeRoomByUser.delete(socket.data.userId);

    for (const socketId of socketIdsByUser.get(socket.data.userId) ?? []) {
      const userSocket = io.sockets.sockets.get(socketId);
      userSocket?.leave(room.roomId);
      userSocket?.emit("room:left", {
        roomId: room.roomId,
        reason: "left",
      });
    }

    if (room.members.length === 0) rooms.delete(room.roomId);
    else {
      appendSystemMessage(room, `${leavingUsername} left the room.`);
      if (wasHost) {
        room.hostUserId = room.members[0].userId;
        appendSystemMessage(room, `${room.members[0].username} is now the host.`);
      }
      broadcastState(room);
    }
    callback(success(null));
  });

  socket.on("room:problem:set", async (payload, callback) => {
    const parsed = setProblemSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid problem request."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = requirePermission(
      room,
      socket.data.userId,
      "canChangeProblem",
      "You do not have permission to change the problem.",
    );
    if (denied) return callback(denied);
    const problem = await getProblem(parsed.data.problemId, socket.data.token);
    if (!problem) return callback(failure("Problem not found."));
    room.problem = problem;
    room.code = problem.starterCode;
    broadcastState(room);
    callback(success(room));
  });

  socket.on("room:timer:start", (payload, callback) => {
    const parsed = timerActionSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid timer request."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = hostOnlyTimerAction(room, socket.data.userId);
    if (denied) return callback(denied);

    if (room.timer.status !== "running") {
      room.timer = {
        status: "running",
        elapsedMs: elapsedTimerMs(room.timer),
        startedAt: new Date().toISOString(),
      };
    }

    broadcastState(room);
    callback(success(room));
  });

  socket.on("room:timer:pause", (payload, callback) => {
    const parsed = timerActionSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid timer request."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = hostOnlyTimerAction(room, socket.data.userId);
    if (denied) return callback(denied);

    room.timer = {
      status: "paused",
      elapsedMs: elapsedTimerMs(room.timer),
      startedAt: null,
    };

    broadcastState(room);
    callback(success(room));
  });

  socket.on("room:timer:reset", (payload, callback) => {
    const parsed = timerActionSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid timer request."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = hostOnlyTimerAction(room, socket.data.userId);
    if (denied) return callback(denied);

    room.timer = initialTimer();
    broadcastState(room);
    callback(success(room));
  });

  socket.on("code:update", (payload) => {
    const parsed = codeUpdateSchema.safeParse(payload);
    if (!parsed.success) return;
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return;
    if (!memberCan(room, socket.data.userId, "canEditCode")) return;
    room.code = parsed.data.code;
    socket.to(room.roomId).emit("code:updated", room.code);
  });

  socket.on("code:replace", (payload, callback) => {
    if (typeof callback !== "function") return;
    const parsed = codeReplaceSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid code replacement."));
    const { roomId, problemId, expectedCode, code } = parsed.data;
    const room = roomForMember(roomId, socket.data.userId);
    if (!room || !socket.rooms.has(roomId) || !memberCan(room, socket.data.userId, "canEditCode")) {
      return callback(failure("You must be connected with edit permission to replace shared code."));
    }
    if (room.problem?.id !== problemId || room.code !== expectedCode) {
      return callback(failure("The shared exercise or code changed. Try again."));
    }
    room.code = code;
    socket.to(roomId).emit("code:updated", code);
    callback(success(null));
  });

  socket.on("chat:send", (payload, callback) => {
    const parsed = chatSendSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid message."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = requirePermission(
      room,
      socket.data.userId,
      "canChat",
      "You do not have permission to send chat messages.",
    );
    if (denied) return callback(denied);
    const message = {
      type: "user" as const,
      id: randomUUID(),
      userId: socket.data.userId,
      username: socket.data.username,
      body: parsed.data.body,
      sentAt: new Date().toISOString(),
    };
    room.messages.push(message);
    io.to(room.roomId).emit("chat:message", message);
    callback(success(null));
  });

  socket.on("whiteboard:stroke:add", (payload, callback) => {
    const parsed = whiteboardStrokeAddSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid whiteboard stroke."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = requirePermission(
      room,
      socket.data.userId,
      "canDrawWhiteboard",
      "You do not have permission to draw on the whiteboard.",
    );
    if (denied) return callback(denied);
    if (room.whiteboard.length >= maxWhiteboardStrokes) {
      return callback(failure("Whiteboard stroke limit reached."));
    }

    const stroke: WhiteboardStroke = {
      ...parsed.data.stroke,
      id: randomUUID(),
      authorUserId: socket.data.userId,
    };

    room.whiteboard.push(stroke);
    io.to(room.roomId).emit("whiteboard:stroke:added", stroke);
    callback(success(stroke));
  });

  socket.on("whiteboard:undo", (payload, callback) => {
    const parsed = whiteboardUndoSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room ID."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = requirePermission(
      room,
      socket.data.userId,
      "canDrawWhiteboard",
      "You do not have permission to undo whiteboard strokes.",
    );
    if (denied) return callback(denied);

    const strokeIndex = room.hostUserId === socket.data.userId
      ? room.whiteboard.length - 1
      : room.whiteboard.map((stroke) => stroke.authorUserId).lastIndexOf(socket.data.userId);

    if (strokeIndex < 0) return callback(failure("No whiteboard stroke to undo."));

    const [removedStroke] = room.whiteboard.splice(strokeIndex, 1);
    io.to(room.roomId).emit("whiteboard:undone", { strokeId: removedStroke.id });
    callback(success({ strokeId: removedStroke.id }));
  });

  socket.on("whiteboard:clear", (payload, callback) => {
    const parsed = roomIdSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room ID."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const denied = requirePermission(
      room,
      socket.data.userId,
      "canDrawWhiteboard",
      "You do not have permission to clear the whiteboard.",
    );
    if (denied) return callback(denied);
    room.whiteboard = [];
    io.to(room.roomId).emit("whiteboard:cleared");
    callback(success(null));
  });

  socket.on("room:member:permissions:set", (payload, callback) => {
    const parsed = setMemberPermissionsSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid permissions request."));

    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    if (room.hostUserId !== socket.data.userId) {
      return callback(failure("Only the room host can manage permissions.", "FORBIDDEN"));
    }

    const member = room.members.find((item) => item.userId === parsed.data.memberUserId);
    if (!member) return callback(failure("Member not found."));
    if (member.userId === room.hostUserId) {
      return callback(failure("Host permissions cannot be changed.", "FORBIDDEN"));
    }

    member.permissions = parsed.data.permissions;
    broadcastState(room);
    callback(success(room));
  });
});

server.listen(port, host, () => {
  const address = server.address();
  if (address && typeof address !== "string") console.log(`Realtime server listening on http://${host}:${address.port}`);
});
