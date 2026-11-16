"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Code2, DoorOpen, LogIn, LogOut, Users } from "lucide-react";
import type { Acknowledgement, Problem, RoomState } from "@leetcollab/contracts";
import { nextLocalDay } from "../lib/review-day";
import { supabase } from "../lib/supabase";
import { useAuth } from "../components/auth-provider";
import { GoogleSignInButton } from "../components/google-sign-in-button";
import { useSocket } from "../components/socket-provider";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";

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
const roomRequestTimeoutMs = 10_000;

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
  const { session } = useAuth();
  return <SessionHomePage key={session?.access_token ?? "signed-out"} />;
}

function SessionHomePage() {
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
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [roomPending, setRoomPending] = useState(false);
  const [roomUnconfirmed, setRoomUnconfirmed] = useState(false);
  const cancelRoomRequest = useRef<(() => void) | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connected = () => {
      clearTimeout(timer);
      setConnection("connected");
    };
    const disconnected = () => {
      clearTimeout(timer);
      setConnection("disconnected");
    };
    socket?.on("connect", connected);
    socket?.on("disconnect", disconnected);
    socket?.on("connect_error", disconnected);
    if (socket?.connected) connected();
    else if (!socket || socket.active) {
      setConnection("connecting");
      timer = setTimeout(disconnected, roomRequestTimeoutMs);
    } else disconnected();
    return () => {
      clearTimeout(timer);
      socket?.off("connect", connected);
      socket?.off("disconnect", disconnected);
      socket?.off("connect_error", disconnected);
    };
  }, [socket, connectionAttempt]);

  useEffect(() => {
    setRoomPending(false);
    return () => {
      cancelRoomRequest.current?.();
      cancelRoomRequest.current = null;
    };
  }, [socket]);

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
    let current = true;
    supabase.from("user_problem_progress").select("problem_id").eq("user_id", session.user.id).lt("suggested_review_at", nextLocalDay(new Date()).toISOString()).then(({ data, error }) => {
      if (!current) return;
      if (error) setReviewError(error.message);
      else setDueIds((data ?? []).map(row => row.problem_id));
    });
    supabase.from("problems").select(problemSelect).order("sort_order")
      .then(({ data, error }) => {
        if (!current) return;
        if (error) setStatus(error.message);
        else setProblems(((data ?? []) as ProblemRow[]).map(normalizeProblem));
      });
    return () => { current = false; };
  }, [session]);

  useEffect(() => {
    if (!session || !socket) {
      setCurrentRoomId(null);
      return;
    }

    let generation = 0;
    const invalidate = () => { generation++; };
    const loadCurrentRoom = () => {
      const requestGeneration = ++generation;
      socket.timeout(roomRequestTimeoutMs).emit("room:current", (error, response) => {
        if (!error && requestGeneration === generation && response.ok) {
          setCurrentRoomId(response.data?.roomId ?? null);
        }
      });
    };

    socket.on("connect", loadCurrentRoom);
    socket.on("disconnect", invalidate);
    if (socket.connected) loadCurrentRoom();

    return () => {
      invalidate();
      socket.off("connect", loadCurrentRoom);
      socket.off("disconnect", invalidate);
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

  function requestRoom(action: "create" | "join", id: string) {
    if (cancelRoomRequest.current || roomUnconfirmed) return;
    if (!socket?.connected) {
      setStatus("");
      setConnection("disconnected");
      return;
    }
    setStatus("");
    setRoomUnconfirmed(false);
    setRoomPending(true);
    let current = true;
    const cancel = () => { current = false; };
    cancelRoomRequest.current = cancel;
    const complete = (error: Error | null, response?: Acknowledgement<RoomState>) => {
      if (!current) return;
      current = false;
      if (error || !response) {
        cancelRoomRequest.current = null;
        setRoomPending(false);
        setRoomUnconfirmed(true);
        return setStatus(`Room ${action === "create" ? "creation" : "join"} was not confirmed. It may have succeeded. Reload to check for an active room before trying again.`);
      }
      if (!response.ok) {
        cancelRoomRequest.current = null;
        setRoomPending(false);
        if (response.code === "ALREADY_IN_ROOM" && response.currentRoomId) {
          setCurrentRoomId(response.currentRoomId);
        }
        return setStatus(response.error);
      }
      router.push(`/room/${response.data.roomId}`);
    };
    // Never buffer a room mutation while disconnected or retry it automatically.
    if (action === "create") {
      socket.volatile.timeout(roomRequestTimeoutMs).emit("room:create", { problemId: id }, complete);
    } else {
      socket.volatile.timeout(roomRequestTimeoutMs).emit("room:join", { roomId: id }, complete);
    }
  }

  function createRoom(problemId: string) {
    requestRoom("create", problemId);
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    requestRoom("join", roomId);
  }

  function reconnect() {
    if (socket && !socket.active) socket.connect();
    if (!roomUnconfirmed) setStatus("");
    setConnectionAttempt(attempt => attempt + 1);
  }

  if (loading) {
    return (
      <main className="auth-page">
        <Card className="auth-card loading-auth-card">
          <CardHeader>
            <Skeleton className="skeleton-brand" />
            <Skeleton className="skeleton-heading" />
            <Skeleton className="skeleton-copy" />
          </CardHeader>
          <CardContent className="auth-form">
            <Skeleton className="skeleton-input" />
            <Skeleton className="skeleton-input" />
            <Skeleton className="skeleton-button" />
          </CardContent>
          <p className="loading-label">Loading session…</p>
        </Card>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-page">
        <div className="auth-glow auth-glow-one" aria-hidden="true" />
        <div className="auth-glow auth-glow-two" aria-hidden="true" />
        <Card className="auth-card">
          <CardHeader className="auth-header">
            <div className="brand auth-brand">
              <span className="brand-icon"><Code2 aria-hidden="true" /></span>
              <span>LeetCollab</span>
            </div>
            <div>
              <CardTitle>{mode === "sign-in" ? "Sign in" : "Create account"}</CardTitle>
              <CardDescription>Collaborate and solve coding challenges together.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="auth-form" onSubmit={authenticate}>
              {mode === "sign-up" && (
                <div className="form-field">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    autoComplete="username"
                    id="username"
                    maxLength={32}
                    minLength={3}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Username"
                    required
                    value={username}
                  />
                </div>
              )}
              <div className="form-field">
                <Label htmlFor="email">Email</Label>
                <Input
                  autoComplete="email"
                  id="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <div className="form-field">
                <Label htmlFor="password">Password</Label>
                <Input
                  autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                  id="password"
                  minLength={6}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  required
                  type="password"
                  value={password}
                />
              </div>
              <Button className="auth-submit" size="lg" type="submit">
                <LogIn aria-hidden="true" />
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </Button>
            </form>
            <GoogleSignInButton />
            {status && (
              <Alert className="auth-alert" variant={status.includes("created") ? "success" : "destructive"}>
                <AlertDescription>{status}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="auth-footer">
            <Button onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} variant="link">
              Switch to {mode === "sign-in" ? "sign up" : "sign in"}
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div className="brand">
          <span className="brand-icon"><Code2 aria-hidden="true" /></span>
          <div>
            <strong>LeetCollab</strong>
            <span>Signed in as {session.user.user_metadata.username ?? session.user.email}</span>
          </div>
        </div>
        <Button onClick={() => supabase.auth.signOut()} variant="outline">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </header>

      {connection !== "connected" && (
        <Alert className="room-connection-alert" variant={connection === "disconnected" ? "destructive" : "default"}>
          <AlertDescription>
            {connection === "connecting"
              ? "Connecting to the collaboration server…"
              : "Not connected to the collaboration server. Reconnect, then create or join a room. If the connection still fails, reload the page."}
          </AlertDescription>
          {connection === "disconnected" && <Button onClick={reconnect} variant="outline">Reconnect</Button>}
        </Alert>
      )}
      {roomPending && <p role="status">Waiting for room confirmation…</p>}
      {status && (
        <Alert className="room-connection-alert" variant="destructive">
          <AlertDescription>{status}</AlertDescription>
          {roomUnconfirmed && <Button onClick={() => window.location.reload()} variant="outline">Reload to check current room</Button>}
        </Alert>
      )}
      <Card className="due-reviews-card">
        <CardHeader>
          <CardTitle>Due today</CardTitle>
          <CardDescription>Suggested reviews are voluntary.</CardDescription>
        </CardHeader>
        <CardContent className="due-reviews-content">
          {reviewError ? (
            <Alert variant="destructive"><AlertDescription>{reviewError}</AlertDescription></Alert>
          ) : dueIds.length ? (
            problems.filter(problem => dueIds.includes(problem.id)).map(problem => (
              <Button disabled={roomPending || roomUnconfirmed} key={problem.id} onClick={() => createRoom(problem.id)} variant="outline">{problem.title}</Button>
            ))
          ) : <p>No reviews due.</p>}
          <p className="muted">Demo history (example only, not your progress): Parcel Pair · Good · suggested review in 3 days.</p>
        </CardContent>
      </Card>

      {currentRoomId ? (
        <Card className="active-room-card">
          <CardHeader>
            <div className="section-icon"><Users aria-hidden="true" /></div>
            <div>
              <CardTitle>You have an active room</CardTitle>
              <CardDescription>Leave your current room before creating or joining another one.</CardDescription>
            </div>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => router.push(`/room/${currentRoomId}`)}>
              Return to current room
              <ArrowRight aria-hidden="true" />
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <>
          <Card className="join-room-card">
            <CardHeader>
              <div className="section-icon"><DoorOpen aria-hidden="true" /></div>
              <div>
                <CardTitle>Join an existing room</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <form className="join-room-form" onSubmit={joinRoom}>
                <Input
                  aria-label="Room ID"
                  onChange={(event) => setRoomId(event.target.value.toLowerCase())}
                  placeholder="8-character room ID"
                  required
                  value={roomId}
                />
                <Button disabled={roomPending || roomUnconfirmed} type="submit">Join room</Button>
              </form>
            </CardContent>
          </Card>

          <section className="problems-section">
            <div className="section-heading">
              <h1>Start a new room</h1>
            </div>
            <div className="problem-grid">
              {problems.map((problem) => (
                <Button
                  className="problem-card"
                  disabled={roomPending || roomUnconfirmed}
                  key={problem.id}
                  onClick={() => createRoom(problem.id)}
                  variant="outline"
                >
                  <span className="problem-card-topline">
                    <Badge
                      variant={problem.difficulty === "Easy"
                        ? "success"
                        : problem.difficulty === "Medium" ? "warning" : "destructive"}
                    >
                      {problem.difficulty}
                    </Badge>
                    <span className="problem-slug">{problem.slug}</span>
                  </span>
                  <strong>{problem.title}</strong>
                  <span className="problem-card-action">
                    Start collaboration room
                    <ArrowRight aria-hidden="true" />
                  </span>
                </Button>
              ))}
            </div>
          </section>
        </>
      )}

    </main>
  );
}
