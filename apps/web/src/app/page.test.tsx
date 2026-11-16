// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HomePage from "./page";
import { SocketProvider, useSocket } from "../components/socket-provider";

const fixtures = vi.hoisted(() => ({
  auth: {
    loading: false,
    session: { access_token: "synthetic-token", user: { id: "synthetic-user", user_metadata: { username: "tester" } } },
  },
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: fixtures.push }) }));
vi.mock("../components/auth-provider", () => ({ useAuth: () => fixtures.auth }));
vi.mock("../lib/supabase", () => ({ supabase: {
  from: (table: string) => ({ select: () => ({
    eq: () => ({ lt: async () => ({ data: [], error: null }) }),
    order: async () => ({ data: table === "problems" ? [{
      id: "11111111-1111-4111-8111-111111111111", title: "Parcel Pair", slug: "parcel-pair",
      difficulty: "Easy", category: "Arrays", sort_order: 1, statement: "Example", starter_code: "", examples: [], constraints: [],
    }] : [], error: null }),
  }) }),
} }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let server: Server;
let root: Root;
let container: HTMLDivElement;
let socket: ClientSocket;
let rejectConnection: boolean;
let holdConnection: boolean;
const requests: string[] = [];
const replies: Array<(value: unknown) => void> = [];
let currentRoom: string | null;

function ObserveSocket() {
  socket = useSocket() as ClientSocket;
  return null;
}

async function renderHome() {
  await act(async () => root.render(<SocketProvider><ObserveSocket /><HomePage /></SocketProvider>));
}

async function until(predicate: () => boolean) {
  for (let count = 0; count < 200; count++) {
    if (predicate()) return;
    await act(async () => { await delay(10); });
  }
  throw new Error("Local socket condition did not settle");
}

function button(text: string) {
  const result = Array.from(container.querySelectorAll("button")).find(el => el.textContent?.includes(text));
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

async function join() {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Room ID"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "abcdefgh");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Join room").click());
}

async function create() {
  await act(async () => button("Start collaboration room").click());
}

const actions = [["join", join], ["create", create]] as const;

beforeEach(async () => {
  vi.clearAllMocks();
  rejectConnection = false;
  holdConnection = false;
  requests.length = 0;
  replies.length = 0;
  currentRoom = null;
  fixtures.auth.session = { access_token: "synthetic-token", user: { id: "synthetic-user", user_metadata: { username: "tester" } } };
  server = new Server(createServer(), { transports: ["websocket"] });
  server.use((client, next) => {
    if (holdConnection) return;
    next(rejectConnection || client.handshake.auth.token !== fixtures.auth.session.access_token
      ? new Error("Synthetic connection rejection") : undefined);
  });
  server.on("connection", client => {
    client.on("room:current", callback => callback({ ok: true, data: currentRoom ? { roomId: currentRoom } : null }));
    for (const event of ["room:create", "room:join"]) {
      client.on(event, (_payload, callback) => { requests.push(event); replies.push(callback); });
    }
  });
  await new Promise<void>(resolve => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address() as { port: number };
  vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", `http://127.0.0.1:${address.port}`);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  await new Promise<void>(resolve => server.close(() => resolve()));
  document.body.replaceChildren();
  vi.unstubAllEnvs();
});

// The hosted failure's oracle is visible feedback and no buffered mutation when
// an authenticated user submits with an existing inactive socket.
it.each(actions)("reports an inactive connection and recovers only on user request (%s)", async (_name, action) => {
  rejectConnection = true;
  await renderHome();
  await until(() => !!socket && !socket.active);
  expect(socket.connected).toBe(false);
  await action();
  expect(container.textContent).toMatch(/not connected|could not connect/i);
  expect(requests).toEqual([]);
  expect(fixtures.push).not.toHaveBeenCalled();
  rejectConnection = false;
  await act(async () => button("Reconnect").click());
  await until(() => socket.connected);
  expect(requests).toEqual([]);
  await action();
  await until(() => requests.length === 1);
  replies[0]({ ok: true, data: { roomId: "abcdefgh" } });
  await until(() => fixtures.push.mock.calls.length === 1);
  expect(fixtures.push).toHaveBeenCalledWith("/room/abcdefgh");
});

it.each(actions)("navigates after a normal connected acknowledgement (%s)", async (_name, action) => {
  await renderHome();
  await until(() => socket?.connected);
  await action();
  await until(() => requests.length === 1);
  replies[0]({ ok: true, data: { roomId: "abcdefgh" } });
  await until(() => fixtures.push.mock.calls.length === 1);
  expect(requests).toEqual([action === join ? "room:join" : "room:create"]);
});

it.each(actions)("bounds an unanswered request and ignores its late acknowledgement (%s)", async (_name, action) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await renderHome();
  await until(() => socket?.connected);
  await action();
  await until(() => requests.length === 1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(container.textContent).toMatch(/not confirmed|timed out/i);
  expect(button("Reload to check current room")).toBeDefined();
  expect(button("Join room").disabled).toBe(true);
  expect(button("Start collaboration room").disabled).toBe(true);
  expect(fixtures.push).not.toHaveBeenCalled();
  replies[0]({ ok: true, data: { roomId: "abcdefgh" } });
  await act(async () => { await delay(30); });
  expect(fixtures.push).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

it.each(actions)("shows connection loss without replaying the request after reconnect (%s)", async (_name, action) => {
  await renderHome();
  await until(() => socket?.connected);
  await action();
  await until(() => requests.length === 1);
  server.disconnectSockets(true);
  await until(() => !socket.connected);
  expect(container.textContent).toMatch(/not confirmed|connection.*lost/i);
  expect(fixtures.push).not.toHaveBeenCalled();
  await act(async () => button("Reconnect").click());
  await until(() => socket.connected);
  expect(requests).toHaveLength(1);
  expect(button("Reload to check current room")).toBeDefined();
  expect(button("Start collaboration room").disabled).toBe(true);
});

it("preserves the active-room recovery returned by the server", async () => {
  await renderHome();
  await until(() => socket?.connected);
  await join();
  await until(() => requests.length === 1);
  replies[0]({ ok: false, code: "ALREADY_IN_ROOM", currentRoomId: "existing", error: "Leave your current room first." });
  await until(() => container.textContent!.includes("Return to current room"));
  await act(async () => button("Return to current room").click());
  expect(fixtures.push).toHaveBeenCalledWith("/room/existing");
});

it("bounds a stalled connection and a stalled user-requested reconnect", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  holdConnection = true;
  await renderHome();
  await until(() => server.engine.clientsCount === 1);
  expect(container.textContent).toContain("Connecting to the collaboration server");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(container.textContent).toContain("Not connected");
  await act(async () => button("Reconnect").click());
  expect(container.textContent).toContain("Connecting to the collaboration server");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(button("Reconnect").disabled).toBe(false);
  expect(requests).toEqual([]);
});

it("shows another rejected reconnect without an automatic retry loop", async () => {
  rejectConnection = true;
  await renderHome();
  await until(() => !!socket && !socket.active);
  let errors = 0;
  socket.on("connect_error", () => { errors++; });
  await act(async () => button("Reconnect").click());
  await until(() => errors === 1);
  expect(socket.active).toBe(false);
  expect(container.textContent).toContain("Not connected");
  expect(button("Reconnect").disabled).toBe(false);
  expect(requests).toEqual([]);
});

it("keeps server rejection messages and permits a new user-requested join", async () => {
  await renderHome();
  await until(() => socket?.connected);
  await join();
  await until(() => requests.length === 1);
  replies[0]({ ok: false, code: "ROOM_NOT_FOUND", error: "Room not found or has ended." });
  await until(() => container.textContent!.includes("Room not found or has ended."));
  await join();
  await until(() => requests.length === 2);
  replies[1]({ ok: true, data: { roomId: "abcdefgh" } });
  await until(() => fixtures.push.mock.calls.length === 1);
});

it("allows only one room request while confirmation is pending", async () => {
  await renderHome();
  await until(() => socket?.connected);
  await create();
  await create();
  await join();
  await until(() => requests.length === 1);
  expect(button("Join room").disabled).toBe(true);
  expect(button("Start collaboration room").disabled).toBe(true);
  replies[0]({ ok: true, data: { roomId: "abcdefgh" } });
  await until(() => fixtures.push.mock.calls.length === 1);
  expect(requests).toEqual(["room:create"]);
});

it("finds an existing room on reconnect without replaying an unconfirmed creation", async () => {
  await renderHome();
  await until(() => socket?.connected);
  await create();
  await until(() => requests.length === 1);
  currentRoom = "abcdefgh";
  server.disconnectSockets(true);
  await until(() => !socket.connected);
  await act(async () => button("Reconnect").click());
  await until(() => container.textContent!.includes("Return to current room"));
  await act(async () => button("Return to current room").click());
  expect(fixtures.push).toHaveBeenCalledWith("/room/abcdefgh");
  expect(requests).toEqual(["room:create"]);
});

it("ignores acknowledgements after navigating away", async () => {
  await renderHome();
  await until(() => socket?.connected);
  await create();
  await until(() => requests.length === 1);
  await act(async () => root.render(<SocketProvider><ObserveSocket /><p>Another page</p></SocketProvider>));
  replies[0]({ ok: true, data: { roomId: "abcdefgh" } });
  await act(async () => { await delay(30); });
  expect(fixtures.push).not.toHaveBeenCalled();
});

it("does not reset a connected socket for an unchanged auth token", async () => {
  await renderHome();
  await until(() => socket?.connected);
  const originalSocket = socket;
  fixtures.auth.session = { ...fixtures.auth.session };
  await renderHome();
  expect(socket).toBe(originalSocket);
  expect(socket.connected).toBe(true);
});

it("uses a changed auth token for a fresh connection and ignores the old request", async () => {
  await renderHome();
  await until(() => socket?.connected);
  await create();
  await until(() => requests.length === 1);
  const originalSocket = socket;
  fixtures.auth.session = { ...fixtures.auth.session, access_token: "renewed-synthetic-token" };
  await renderHome();
  await until(() => socket !== originalSocket && socket.connected);
  expect(originalSocket.active).toBe(false);
  replies[0]({ ok: true, data: { roomId: "abcdefgh" } });
  await act(async () => { await delay(30); });
  expect(fixtures.push).not.toHaveBeenCalled();
});
