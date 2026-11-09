"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Code2, DoorOpen, LogIn, LogOut, Users } from "lucide-react";
import type { Problem } from "@leetcollab/contracts";
import { supabase } from "../lib/supabase";
import { useAuth } from "../components/auth-provider";
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
  const [roomId, setRoomId] = useState("");
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
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
                <Button type="submit">Join room</Button>
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

      {status && (
        <Alert className="dashboard-alert" variant="destructive">
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      )}
    </main>
  );
}
