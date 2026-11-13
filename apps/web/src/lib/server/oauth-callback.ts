import { NextResponse } from "next/server";
import { safeRelativePath } from "../auth-redirect";

type ExchangeCode = (code: string) => Promise<{ error: unknown | null }>;

export async function completeOAuthCallback(request: Request, exchangeCode: ExchangeCode): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const next = safeRelativePath(requestUrl.searchParams.get("next"));
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.has("error");

  if (!code || providerError) {
    const target = new URL("/", requestUrl.origin);
    target.searchParams.set("authError", providerError ? "oauth_denied" : "oauth_missing_code");
    return NextResponse.redirect(target, 303);
  }

  try {
    const result = await exchangeCode(code);
    if (result.error) throw new Error("exchange failed");
    return NextResponse.redirect(new URL(next, requestUrl.origin), 303);
  } catch {
    const target = new URL("/", requestUrl.origin);
    target.searchParams.set("authError", "oauth_failed");
    return NextResponse.redirect(target, 303);
  }
}
