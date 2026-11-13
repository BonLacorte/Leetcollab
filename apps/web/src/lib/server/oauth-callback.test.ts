import { describe, expect, it, vi } from "vitest";
import { completeOAuthCallback } from "./oauth-callback";

describe("completeOAuthCallback", () => {
  it("exchanges a PKCE code and redirects to the sanitized next path", async () => {
    const exchange = vi.fn(async () => ({ error: null }));
    const response = await completeOAuthCallback(
      new Request("https://app.example/auth/callback?code=one-time&next=%2Fprogress%3Ffilter%3Ddue"),
      exchange,
    );

    expect(exchange).toHaveBeenCalledWith("one-time");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example/progress?filter=due");
  });

  it("prevents an external redirect after a successful exchange", async () => {
    const response = await completeOAuthCallback(
      new Request("https://app.example/auth/callback?code=ok&next=https%3A%2F%2Fevil.example"),
      async () => ({ error: null }),
    );
    expect(response.headers.get("location")).toBe("https://app.example/");
  });

  it("returns a stable error code without reflecting provider details", async () => {
    const exchange = vi.fn(async () => ({ error: null }));
    const response = await completeOAuthCallback(
      new Request("https://app.example/auth/callback?error=access_denied&error_description=private-provider-detail"),
      exchange,
    );
    const location = response.headers.get("location") ?? "";
    expect(exchange).not.toHaveBeenCalled();
    expect(location).toBe("https://app.example/?authError=oauth_denied");
    expect(location).not.toContain("private-provider-detail");
  });

  it("handles a failed code exchange without exposing its error", async () => {
    const response = await completeOAuthCallback(
      new Request("https://app.example/auth/callback?code=expired"),
      async () => ({ error: new Error("secret provider response") }),
    );
    const location = response.headers.get("location") ?? "";
    expect(location).toBe("https://app.example/?authError=oauth_failed");
    expect(location).not.toContain("secret");
  });
});
