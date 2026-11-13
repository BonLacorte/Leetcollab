import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PracticeControls } from "./practice-controls";

vi.mock("./auth-provider", () => ({ useAuth: () => ({ session: { access_token: "token", user: { id: "user" } } }) }));
vi.mock("../lib/supabase", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) } }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([false, true])("ignores an older status success or failure after exhaustion (failure=%s)", async failure => {
  const pending: { resolve: (value: Response) => void; reject: (reason: Error) => void }[] = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject }))));
  const status = (remaining: number) => new Response(JSON.stringify({ available: remaining > 0, used: 20 - remaining, limit: 20, remaining, active: 0, resetAt: "2026-11-13T23:55:00.000Z", fallback: null, unavailableReason: remaining ? null : "quota_exhausted" }));
  await act(async () => { renderer = create(<PracticeControls problemId="problem" code="class Solution {}" />); });
  await act(async () => pending[0].resolve(status(1)));
  const button = (label: string) => renderer.root.findAllByType("button").find(node => node.children.includes(label))!;
  await act(async () => button("Refresh status").props.onClick());
  await act(async () => { void button("Run Java").props.onClick(); });
  await act(async () => pending[2].resolve(new Response(JSON.stringify({ ok: false, error: { code: "QUOTA_EXHAUSTED", message: "Exhausted" } }))));
  await act(async () => pending[3].resolve(status(0)));
  await act(async () => { if (failure) pending[1].reject(new Error("offline")); else pending[1].resolve(status(1)); });
  expect(button("Run Java").props.disabled).toBe(true);
  expect(JSON.stringify(renderer.toJSON())).toContain("This original exercise must wait for quota reset.");
  expect(JSON.stringify(renderer.toJSON())).not.toContain("Judge status unavailable.");
});
