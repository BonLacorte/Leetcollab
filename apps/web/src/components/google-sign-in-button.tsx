"use client";

import { useState } from "react";
import { safeRelativePath } from "../lib/auth-redirect";
import { supabase } from "../lib/supabase";

export function GoogleSignInButton({ next = "/" }: { next?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setPending(true);
    setError("");
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", safeRelativePath(next));
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString() },
      });
      if (authError) {
        setError("Google sign-in could not be started. Please try again.");
        setPending(false);
      }
    } catch {
      setError("Google sign-in could not be started. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <button className="secondary" type="button" onClick={signIn} disabled={pending}>
        {pending ? "Opening Google..." : "Continue with Google"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
