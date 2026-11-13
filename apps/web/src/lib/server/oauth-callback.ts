import { NextResponse } from "next/server";
import { safeRelativePath } from "../auth-redirect";

type ExchangeCode = (code: string) => Promise<{ error: unknown | null }>;

function redirect(path: string): NextResponse {
  // A relative Location keeps the browser's origin even when Next's request URL
  // uses the server bind address. Destinations must remain sanitized internal paths.
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function completeOAuthCallback(request: Request, exchangeCode: ExchangeCode): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const next = safeRelativePath(requestUrl.searchParams.get("next"));
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.has("error");

  if (!code || providerError) {
    return redirect(`/?authError=${providerError ? "oauth_denied" : "oauth_missing_code"}`);
  }

  try {
    const result = await exchangeCode(code);
    if (result.error) throw new Error("exchange failed");
    return redirect(next);
  } catch {
    return redirect("/?authError=oauth_failed");
  }
}
