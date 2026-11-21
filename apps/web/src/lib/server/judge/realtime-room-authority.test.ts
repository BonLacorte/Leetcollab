import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ClientToServerEvents, ServerToClientEvents } from "@leetcollab/contracts";
import { io, type Socket } from "socket.io-client";
import { expect, it } from "vitest";

const actor = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
const late = "33333333-3333-4333-8333-333333333333";
const problem = "44444444-4444-4444-8444-444444444444";
const submission = "55555555-5555-4555-8555-555555555555";
const roomId = "abcdefgh";

it("checks replacements against live room state, waits for rejoin, and refreshes captured sockets only", async () => {
  let refreshLookup: unknown;
  const databaseBoundary = createServer(async (request, response) => {
    if (request.url === "/rest/v1/rpc/judge_refresh_recipients") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      refreshLookup = JSON.parse(Buffer.concat(chunks).toString());
    }
    const user = request.headers.authorization?.slice("Bearer ".length);
    const data = request.url === "/auth/v1/user" && user && [actor, peer, late].includes(user)
      ? { id: user, user_metadata: { username: user } }
      : request.url?.startsWith("/rest/v1/problems?")
        ? { id: problem, slug: "fixture", title: "Fixture", category: "Arrays", difficulty: "Easy", sort_order: 1,
          statement: "", starter_code: "starter", examples: [], constraints: [] }
        : request.url === "/rest/v1/rpc/judge_refresh_recipients" && user === "synthetic-server-key"
          ? [actor, peer].map(id => ({ user_id: id, room_id: roomId, problem_id: problem }))
          : null;
    response.writeHead(data ? 200 : 404, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  }).listen(0, "127.0.0.1");
  await once(databaseBoundary, "listening");
  const realtime = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: new URL("../../../../../realtime/", import.meta.url),
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", ROOM_RESTORE_FILE: "",
      SUPABASE_URL: `http://127.0.0.1:${(databaseBoundary.address() as AddressInfo).port}`, SUPABASE_ANON_KEY: "synthetic",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const sockets: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];
  try {
    const base = await new Promise<string>((resolve, reject) => {
      realtime.once("error", reject);
      realtime.once("exit", code => reject(new Error(`Realtime exited with status ${code}`)));
      realtime.stdout.setEncoding("utf8").on("data", (text: string) => {
        const address = /Realtime server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(text)?.[1];
        if (address) resolve(address);
      });
    });
    const connect = async (token: string) => {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(base, { auth: { token }, reconnection: false, transports: ["websocket"] });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
      return socket.timeout(2000);
    };
    const owner = await connect(actor);
    expect(await owner.emitWithAck("room:create", { roomId, problemId: problem })).toMatchObject({ ok: true });
    const partner = await connect(peer);
    expect(await partner.emitWithAck("room:join", { roomId })).toMatchObject({ ok: true });

    expect(await owner.emitWithAck("code:replace", { roomId, problemId: problem, expectedCode: "starter", code: "newer" }))
      .toEqual({ ok: true, data: null });
    expect(await owner.emitWithAck("code:replace", { roomId, problemId: problem, expectedCode: "starter", code: "private draft" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("changed") });
    expect(await owner.emitWithAck("code:replace", { roomId, problemId: submission, expectedCode: "newer", code: "old exercise" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("changed") });

    const requestSnapshot = () => fetch(`${base}/judge/participants?problemId=${problem}&roomId=${roomId}`, {
      headers: { Authorization: `Bearer ${actor}` }, signal: AbortSignal.timeout(3000),
    });
    owner.disconnect();
    expect((await requestSnapshot()).status).toBe(409);
    const reconnected = await connect(actor);
    const pending = requestSnapshot();
    expect(await reconnected.emitWithAck("room:join", { roomId })).toMatchObject({ ok: true, data: { code: "newer" } });
    expect(await (await pending).json()).toMatchObject({ roomId, userIds: [actor, peer] });

    const newcomer = await connect(late);
    await newcomer.emitWithAck("room:join", { roomId });
    const notified: string[] = [];
    for (const [user, socket] of [[actor, reconnected], [peer, partner], [late, newcomer]] as const) {
      socket.on("practice:refresh", payload => { if (payload.problemId === problem) notified.push(user); });
    }
    expect((await fetch(`${base}/judge/refresh`, {
      method: "POST", headers: { Authorization: `Bearer ${actor}`, "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: submission }), signal: AbortSignal.timeout(3000),
    })).status).toBe(202);
    for (const socket of [reconnected, partner, newcomer]) await socket.emitWithAck("room:current");
    expect(refreshLookup).toEqual({ p_submission_id: submission, p_actor_id: actor });
    expect(notified.sort()).toEqual([actor, peer]);
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (realtime.exitCode === null && realtime.signalCode === null) {
      const closed = once(realtime, "close");
      realtime.kill();
      await closed;
    }
    databaseBoundary.closeAllConnections();
    await new Promise<void>(resolve => databaseBoundary.close(() => resolve()));
  }
}, 12_000);
