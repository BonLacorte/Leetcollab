import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { completeOAuthCallback } from "../../../lib/server/oauth-callback";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase browser configuration is required.");

  const cookieStore = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        for (const value of values) cookieStore.set(value.name, value.value, value.options);
      },
    },
  });

  return completeOAuthCallback(request, async (code) => {
    const { error } = await client.auth.exchangeCodeForSession(code);
    return { error };
  });
}
