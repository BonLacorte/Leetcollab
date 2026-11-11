"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Problem } from "@leetcollab/contracts";
import { supabase } from "../lib/supabase";
import { useAuth } from "../components/auth-provider";
import { GoogleSignInButton } from "../components/google-sign-in-button";
import { useSocket } from "../components/socket-provider";

type Mode = "sign-in" | "sign-up";
type ProblemRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  difficulty: Problem["difficulty"];
  sort_order: number;
  statement: string;
  starter_code: string;
  examples: Problem["examples"];
  constraints: string[];
};

const problemSelect = "id, slug, title, category, difficulty, sort_order, statement, starter_code, examples, constraints";

function normalizeProblem(row: ProblemRow): Problem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    difficulty: row.difficulty,
    sortOrder: row.sort_order,
    statement: row.statement,
    starterCode: row.starter_code,
    examples: Array.isArray(row.examples) ? row.examples : [],
    constraints: Array.isArray(row.constraints) ? row.constraints : [],
  };
}

export default function HomePage() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const socket = useSocket();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string>("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [dueIds, setDueIds] = useState<string[]>([]);
  const [reviewError, setReviewError] = useState("");
  const [roomId, setRoomId] = useState("");
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);

  useEffect(() => {
    const authError = new URL(window.location.href).searchParams.get("authError");
    if (!authError) return;
    setStatus(authError === "oauth_denied"
      ? "Google sign-in was cancelled."
      : "Google sign-in could not be completed. Please try again.");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from("user_problem_progress").select("problem_id").eq("user_id", session.user.id).lte("suggested_review_at", new Date().toISOString()).then(({ data, error }) => {
      if (error) setReviewError(error.message);
      else setDueIds((data ?? []).map(row => row.problem_id));
    });
    supabase.from("problems").select(problemSelect).order("sort_order")
      .then(({ data, error }) => {
        if (error) setStatus(error.message);
        else setProblems(((data ?? []) as ProblemRow[]).map(normalizeProblem));
      });
  }, [session]);

  useEffect(() => {
    if (!session || !socket) {
      setCurrentRoomId(null);
      return;
    }

    const loadCurrentRoom = () => {
      socket.emit("room:current", (response) => {
        if (response.ok) setCurrentRoomId(response.data?.roomId ?? null);
      });
    };

    socket.on("connect", loadCurrentRoom);
    if (socket.connected) loadCurrentRoom();

    return () => {
      socket.off("connect", loadCurrentRoom);
    };
  }, [session, socket]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setStatus("");
    if (mode === "sign-up") {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
      setStatus(error ? error.message : "Account created. You can now sign in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setStatus(error ? error.message : "Signed in.");
    }
  }

  function createRoom(problemId: string) {
    if (!socket) return setStatus("Connecting to the collaboration server… please try again.");
    socket.emit("room:create", { problemId }, (response) => {
      if (!response.ok) {
        if (response.code === "ALREADY_IN_ROOM" && response.currentRoomId) {
          setCurrentRoomId(response.currentRoomId);
        }
        return setStatus(response.error);
      }
      router.push(`/room/${response.data.roomId}`);
    });
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    if (!socket) return setStatus("Connecting to the collaboration server… please try again.");
    socket.emit("room:join", { roomId }, (response) => {
      if (!response.ok) {
        if (response.code === "ALREADY_IN_ROOM" && response.currentRoomId) {
          setCurrentRoomId(response.currentRoomId);
        }
        return setStatus(response.error);
      }
      router.push(`/room/${response.data.roomId}`);
    });
  }

  if (loading) return <main><p>Loading session…</p></main>;
  if (!session) {
    return <main style={{ maxWidth: 460 }}><div className="card stack">
      <div><h1>LeetCollab</h1><p className="muted">Collaborate and solve coding challenges together.</p></div>
      <form className="stack" onSubmit={authenticate}>
        {mode === "sign-up" && <input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} placeholder="Username" required />}
        <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" required />
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} placeholder="Password" required />
        <button type="submit">{mode === "sign-in" ? "Sign in" : "Create account"}</button>
      </form>
      <GoogleSignInButton />
      <button className="secondary" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>Switch to {mode === "sign-in" ? "sign up" : "sign in"}</button>
      {status && <p className={status.includes("created") ? "success" : "error"}>{status}</p>}
    </div></main>;
  }

  return <main>
    <header className="topbar"><div><h1>LeetCollab</h1><p className="muted">Signed in as {session.user.user_metadata.username ?? session.user.email}</p></div><button className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></header>
    <section className="card stack"><h2>Due today</h2><p>Suggested reviews are voluntary.</p>{reviewError ? <p className="error">{reviewError}</p> : dueIds.length ? problems.filter(problem => dueIds.includes(problem.id)).map(problem => <button key={problem.id} onClick={() => createRoom(problem.id)}>{problem.title}</button>) : <p>No reviews due.</p>}<p className="muted">Demo history (example only, not your progress): Parcel Pair · Good · suggested review in 3 days.</p></section>
    {currentRoomId ? <section className="card stack" style={{ marginBottom: "1rem" }}>
      <h2>You have an active room</h2>
      <p className="muted">Leave your current room before creating or joining another one.</p>
      <button onClick={() => router.push(`/room/${currentRoomId}`)}>Return to current room</button>
    </section> : <>
      <section className="card stack" style={{ marginBottom: "1rem" }}><h2>Join an existing room</h2><form className="row" onSubmit={joinRoom}><input value={roomId} onChange={(event) => setRoomId(event.target.value.toLowerCase())} placeholder="8-character room ID" required /><button>Join room</button></form></section>
      <section><h2>Start a new room</h2><div className="grid">{problems.map((problem) => <button className="card problem" key={problem.id} onClick={() => createRoom(problem.id)}><strong>{problem.title}</strong><span className="muted">{problem.difficulty} · {problem.slug}</span><span>Start collaboration room</span></button>)}</div></section>
    </>}
    {status && <p className="error">{status}</p>}
  </main>;
}
