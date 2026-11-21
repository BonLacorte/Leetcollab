// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Acknowledgement, RoomState } from "@leetcollab/contracts";
import { RoomClient } from "./room-client";

const mocks = vi.hoisted(() => {
  const room: RoomState = {
    roomId: "abcdefgh",
    hostUserId: "11111111-1111-4111-8111-111111111111",
    problem: null,
    code: "",
    timer: { status: "idle", elapsedMs: 0, startedAt: null },
    members: [],
    messages: [],
    whiteboard: [],
  };
  return {
    room,
    auth: { loading: false, session: { access_token: "token", user: { id: "11111111-1111-4111-8111-111111111111" } } },
    router: { push: vi.fn(), replace: vi.fn() },
    socket: {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      timeout() { return this; },
      emit: vi.fn((event: string, _payload: unknown, callback: (response: { ok: true; data: RoomState }) => void) => {
        if (event === "room:join") callback({ ok: true, data: room });
      }),
    },
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("./auth-provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("./socket-provider", () => ({ useSocket: () => mocks.socket }));
vi.mock("./theme-provider", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("../lib/supabase", () => ({ supabase: { from: () => {
  const query = { select: () => query, order: () => query, eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
  return query;
} } }));
vi.mock("@uiw/react-codemirror", async importOriginal => ({ ...await importOriginal<typeof import("@uiw/react-codemirror")>(), default: ({ value, onChange, readOnly }: { value: string; onChange: (value: string) => void; readOnly: boolean }) => <textarea aria-label="Shared code" readOnly={readOnly} value={value} onChange={event => onChange(event.target.value)} /> }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.room.problem = null;
  mocks.room.code = "";
  mocks.auth.session.user.id = "11111111-1111-4111-8111-111111111111";
});

it.each(["exercise", "user"])("clears Result on a %s switch and ignores the previous pending execution", async kind => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const problemId = "33333333-3333-4333-8333-333333333333";
  mocks.room.problem = { id: problemId, slug: "test", title: "Test", category: "Arrays", difficulty: "Easy", sortOrder: 1,
    statement: "", starterCode: "class Solution {}", examples: [], constraints: [] };
  mocks.room.code = mocks.room.problem.starterCode;
  const quota = { available: true, used: 0, limit: 20, remaining: 20, active: 0, resetAt: new Date(Date.now() + 3_600_000).toISOString(), fallback: null, unavailableReason: null };
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method
    ? new Promise<Response>(resolve => { finish = resolve; }) : new Response(JSON.stringify(quota))));
  const container = document.createElement("div"); document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<RoomClient roomId="abcdefgh" />); });
  const run = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Run")!;
  await act(async () => run.click());
  expect(container.querySelector(".result-panel")?.textContent).toContain("Judging");
  await act(async () => {
    if (kind === "exercise") {
      const handler = mocks.socket.on.mock.calls.find(([event]) => event === "room:state")![1] as (state: RoomState) => void;
      handler({ ...mocks.room, problem: { ...mocks.room.problem!, id: "44444444-4444-4444-8444-444444444444" } });
    } else {
      mocks.auth.session.user.id = "55555555-5555-4555-8555-555555555555";
      root!.render(<RoomClient roomId="abcdefgh" />);
    }
  });
  await act(async () => finish(new Response(JSON.stringify({ ok: true, quota, submission: {
    id: "22222222-2222-4222-8222-222222222222", problemId, language: "java", verification: "leetcollab", verdict: "compile_error",
    testsPassed: 0, testsTotal: 4, durationMs: 10, diagnostics: "old result must stay hidden", createdAt: "2026-11-18T03:00:00.000Z",
  } }))));
  expect(container.querySelector(".result-panel")?.textContent).toContain("Run or submit your solution");
  expect(container.textContent).not.toContain("old result must stay hidden");
});

it("keeps a room with no selected problem usable without judge or review controls", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<RoomClient roomId="abcdefgh" />);
  });
  const buttons = Array.from(container.querySelectorAll("button"), button => button.textContent);
  expect(buttons).toContain("Leave Room");
  expect(buttons).not.toContain("Run");
  expect(buttons).not.toContain("Submit");
  expect(buttons).not.toContain("Mark solved");
  expect(container.querySelector('a[aria-label="LeetCollab home"]')?.getAttribute("href")).toBe("/");
  expect(buttons).not.toContain("again");
});

it("keeps an optimistic edit when a peer replacement arrives before its acknowledgement", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mocks.socket.on.mockClear();
  mocks.socket.emit.mockClear();
  mocks.room.problem = {
    id: "33333333-3333-4333-8333-333333333333", slug: "test", title: "Test", category: "Arrays",
    difficulty: "Easy", sortOrder: 1, statement: "", starterCode: "original", examples: [], constraints: [],
  };
  mocks.room.code = "original";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    available: false, used: 0, limit: 25, remaining: 25, active: 0,
    resetAt: new Date(Date.now() + 3_600_000).toISOString(), fallback: null, unavailableReason: "provider_unconfigured",
  }))));
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => { root = createRoot(container); root.render(<RoomClient roomId="abcdefgh" />); });
  const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Shared code"]')!;
  const type = async (code: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, code);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const receive = mocks.socket.on.mock.calls.find(([event]) => event === "code:updated")![1] as (code: string) => void;
  await type("my first edit");
  await type("my latest edit");
  expect(editor.value).toBe("my latest edit");
  await act(async () => receive("peer replacement"));
  expect(editor.value).toBe("my latest edit");
  const acknowledgements = mocks.socket.emit.mock.calls.filter(([event]) => event === "code:update")
    .map(([, , callback]) => callback as unknown as (error: Error | null, response: Acknowledgement<null>) => void);
  expect(acknowledgements).toHaveLength(2);
  await act(async () => acknowledgements[0](null, { ok: true, data: null }));
  expect(editor.value).toBe("my latest edit");
  await act(async () => acknowledgements[1](null, { ok: true, data: null }));
  expect(editor.value).toBe("my latest edit");
  await act(async () => receive("later peer edit"));
  expect(editor.value).toBe("later peer edit");
  await type("rejected local edit");
  await act(async () => receive("authoritative code"));
  const rejected = mocks.socket.emit.mock.lastCall?.[2] as unknown as typeof acknowledgements[number];
  await act(async () => rejected(null, { ok: false, error: "Edit permission changed." }));
  expect(editor.value).toBe("authoritative code");
});
