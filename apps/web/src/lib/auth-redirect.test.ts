import { describe, expect, it } from "vitest";
import { safeRelativePath } from "./auth-redirect";

describe("safeRelativePath", () => {
  it("preserves an internal path and query", () => {
    expect(safeRelativePath("/progress?filter=due")).toBe("/progress?filter=due");
  });

  it.each([
    "https://attacker.example/path",
    "//attacker.example/path",
    "/\\attacker.example/path",
    "/auth/callback?code=loop",
  ])("rejects unsafe redirect %s", (value) => {
    expect(safeRelativePath(value)).toBe("/");
  });
});
