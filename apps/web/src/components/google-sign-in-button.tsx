"use client";

import { useState } from "react";
import { safeRelativePath } from "../lib/auth-redirect";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";

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
    <div className="auth-google">
      <Button variant="outline" type="button" onClick={signIn} disabled={pending}>
        {pending ? "Opening Google..." : "Continue with Google"}
      </Button>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  );
}
