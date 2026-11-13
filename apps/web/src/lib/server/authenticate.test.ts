import { describe, expect, it, vi } from "vitest";
import { authenticateBearer, bearerToken } from "./authenticate";

describe("bearer authentication", () => {
  it("accepts one exact bearer token", async () => {
    const lookup = vi.fn(async (token: string) => token === "valid-token" ? { id: "user-a" } : null);
    const request = new Request("https://app.example/api", {
      headers: { authorization: "Bearer valid-token" },
    });
    await expect(authenticateBearer(request, lookup)).resolves.toBe("user-a");
    expect(lookup).toHaveBeenCalledWith("valid-token");
  });

  it.each([undefined, "Basic abc", "Bearer", "Bearer one two"])("rejects malformed authorization %s", (authorization) => {
    const headers = authorization ? { authorization } : undefined;
    expect(bearerToken(new Request("https://app.example/api", { headers }))).toBeNull();
  });
});
