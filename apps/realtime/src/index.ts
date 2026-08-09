import "dotenv/config";
import http from "node:http";
import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createClient } from "@supabase/supabase-js";
import { Server } from "socket.io";
import {
  chatSendSchema,
  codeUpdateSchema,
  createRoomSchema,
  roomIdSchema,
  setProblemSchema,
  whiteboardDrawSchema,
  type Acknowledgement,
  type ClientToServerEvents,
  type Problem,
  type RoomState,
  type ServerToClientEvents,
} from "@leetcollab/contracts";

const port = Number(process.env.PORT ?? 3001);
const origin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const app = express();
app.use(helmet());
app.use(cors({ origin, credentials: true }));
app.get("/health", (_request, response) => response.json({ ok: true }));

type SocketData = { userId: string; username: string };
type Room = RoomState;
const rooms = new Map<string, Room>();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(server, {
  cors: { origin, methods: ["GET", "POST"], credentials: true },
});

const success = <T>(data: T): Acknowledgement<T> => ({ ok: true, data });
const failure = <T = never>(error: string): Acknowledgement<T> => ({ ok: false, error });

function roomForMember(roomId: string, userId: string): Room | undefined {
  const room = rooms.get(roomId);
  return room?.members.some((member) => member.userId === userId) ? room : undefined;
}

function broadcastState(room: Room): void {
  io.to(room.roomId).emit("room:state", room);
  io.to(room.roomId).emit("room:presence", room.members);
}

async function getProblem(problemId: string): Promise<Problem | null> {
  const { data, error } = await supabase
    .from("problems")
    .select("id, slug, title, difficulty")
    .eq("id", problemId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, slug: data.slug, title: data.title, difficulty: data.difficulty } as Problem;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string") return next(new Error("Authentication is required."));

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return next(new Error("Invalid or expired session."));

  socket.data.userId = data.user.id;
  socket.data.username = typeof data.user.user_metadata.username === "string"
    ? data.user.user_metadata.username
    : data.user.email?.split("@")[0] ?? "coder";
  next();
});

io.on("connection", (socket) => {
  socket.on("room:create", async (payload, callback) => {
    const parsed = createRoomSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room creation request."));
    const problem = await getProblem(parsed.data.problemId);
    if (!problem) return callback(failure("Problem not found."));

    const roomId = parsed.data.roomId ?? randomUUID();
    if (rooms.has(roomId)) return callback(failure("Room already exists."));

    const room: Room = {
      roomId,
      hostUserId: socket.data.userId,
      problem,
      code: "",
      members: [{ userId: socket.data.userId, username: socket.data.username }],
      messages: [],
      whiteboard: [],
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    callback(success(room));
  });

  socket.on("room:join", (payload, callback) => {
    const parsed = roomIdSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room ID."));
    const room = rooms.get(parsed.data.roomId);
    if (!room) return callback(failure("Room not found or has ended."));

    if (!room.members.some((member) => member.userId === socket.data.userId)) {
      room.members.push({ userId: socket.data.userId, username: socket.data.username });
    }
    socket.join(room.roomId);
    broadcastState(room);
    callback(success(room));
  });

  socket.on("room:leave", (payload, callback) => {
    const parsed = roomIdSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room ID."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));

    room.members = room.members.filter((member) => member.userId !== socket.data.userId);
    socket.leave(room.roomId);
    if (room.members.length === 0) rooms.delete(room.roomId);
    else {
      if (room.hostUserId === socket.data.userId) room.hostUserId = room.members[0].userId;
      broadcastState(room);
    }
    callback(success(null));
  });

  socket.on("room:problem:set", async (payload, callback) => {
    const parsed = setProblemSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid problem request."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    if (room.hostUserId !== socket.data.userId) return callback(failure("Only the room host can change the problem."));
    const problem = await getProblem(parsed.data.problemId);
    if (!problem) return callback(failure("Problem not found."));
    room.problem = problem;
    room.code = "";
    broadcastState(room);
    callback(success(room));
  });

  socket.on("code:update", (payload) => {
    const parsed = codeUpdateSchema.safeParse(payload);
    if (!parsed.success) return;
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return;
    room.code = parsed.data.code;
    socket.to(room.roomId).emit("code:updated", room.code);
  });

  socket.on("chat:send", (payload, callback) => {
    const parsed = chatSendSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid message."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    const message = { id: randomUUID(), username: socket.data.username, body: parsed.data.body, sentAt: new Date().toISOString() };
    room.messages.push(message);
    io.to(room.roomId).emit("chat:message", message);
    callback(success(null));
  });

  socket.on("whiteboard:draw", (payload) => {
    const parsed = whiteboardDrawSchema.safeParse(payload);
    if (!parsed.success) return;
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return;
    room.whiteboard.push(parsed.data.point);
    socket.to(room.roomId).emit("whiteboard:drew", parsed.data.point);
  });

  socket.on("whiteboard:clear", (payload, callback) => {
    const parsed = roomIdSchema.safeParse(payload);
    if (!parsed.success) return callback(failure("Invalid room ID."));
    const room = roomForMember(parsed.data.roomId, socket.data.userId);
    if (!room) return callback(failure("You are not in this room."));
    room.whiteboard = [];
    io.to(room.roomId).emit("whiteboard:cleared");
    callback(success(null));
  });
});

server.listen(port, () => console.log(`Realtime server listening on http://localhost:${port}`));
