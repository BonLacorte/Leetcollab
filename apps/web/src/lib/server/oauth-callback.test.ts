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
    expect(response.headers.get("location")).toBe("/progress?filter=due");
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "/auth/callback?code=loop",
    "javascript:alert(1)",
    "",
  ])("prevents an unsafe or empty next value %s after a successful exchange", async (next) => {
    const response = await completeOAuthCallback(
      new Request(`http://0.0.0.0:3260/auth/callback?code=ok&next=${encodeURIComponent(next)}`),
      async () => ({ error: null }),
    );
    expect(response.headers.get("location")).toBe("/");
  });

  it("returns a stable error code without reflecting provider details", async () => {
    const exchange = vi.fn(async () => ({ error: null }));
    const response = await completeOAuthCallback(
      new Request("https://app.example/auth/callback?error=access_denied&error_description=private-provider-detail"),
      exchange,
    );
    const location = response.headers.get("location") ?? "";
    expect(exchange).not.toHaveBeenCalled();
    expect(location).toBe("/?authError=oauth_denied");
    expect(location).not.toContain("private-provider-detail");
  });

  it("handles a failed code exchange without exposing its error", async () => {
    const response = await completeOAuthCallback(
      new Request("https://app.example/auth/callback?code=expired"),
      async () => ({ error: new Error("secret provider response") }),
    );
    const location = response.headers.get("location") ?? "";
    expect(location).toBe("/?authError=oauth_failed");
    expect(location).not.toContain("secret");
  });

  it.each([
    ["", "/?authError=oauth_missing_code", false],
    ["?code=", "/?authError=oauth_missing_code", false],
    ["?code=ignored&error=access_denied&error_description=private-detail", "/?authError=oauth_denied", false],
    ["?code=ok&next=%2Fprogress%3Ffilter%3Ddue%23review", "/progress?filter=due#review", true],
  ])("keeps browser origin despite bind URL and untrusted headers for %s", async (query, target, exchanges) => {
    const exchange = vi.fn(async () => ({ error: null }));
    const response = await completeOAuthCallback(
      new Request(`http://0.0.0.0:3260/auth/callback${query}`, {
        headers: {
          host: "attacker.example",
          origin: "https://attacker.example",
          forwarded: "host=attacker.example;proto=https",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "https",
          "x-forwarded-port": "443",
        },
      }),
      exchange,
    );

    expect(exchange).toHaveBeenCalledTimes(exchanges ? 1 : 0);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(target);
    // Resolve the Location as a browser does, against its visible callback URL.
    expect(new URL(response.headers.get("location")!, "http://localhost:3260/auth/callback").origin)
      .toBe("http://localhost:3260");
  });

  it("ignores an untrusted request origin and return origin parameter", async () => {
    const response = await completeOAuthCallback(
      new Request("https://attacker.example/auth/callback?code=ok&origin=https://evil.example&next=%2Fprogress"),
      async () => ({ error: null }),
    );
    expect(response.headers.get("location")).toBe("/progress");
  });

  it("sanitizes a thrown exchange failure", async () => {
    const response = await completeOAuthCallback(
      new Request("http://0.0.0.0:3260/auth/callback?code=ok"),
      async () => { throw new Error("private provider details"); },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/?authError=oauth_failed");
  });
});
