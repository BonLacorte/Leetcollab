// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { RoomState } from "@leetcollab/contracts";
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
    auth: { loading: false, session: { access_token: "token", user: { id: "11111111-1111-4111-8111-111111111111" } } },
    router: { push: vi.fn(), replace: vi.fn() },
    socket: {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
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
vi.mock("../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));
vi.mock("@uiw/react-codemirror", () => ({ default: ({ value }: { value: string }) => <textarea readOnly value={value} /> }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
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
  expect(buttons).not.toContain("Run Java");
  expect(buttons).not.toContain("again");
});
