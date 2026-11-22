"use client";

import { FormEvent, PointerEvent, WheelEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Problem,
  RoomPermissions,
  RoomState,
  RoomTimer,
  WhiteboardPoint,
  WhiteboardStroke,
  WhiteboardStrokeInput,
  WhiteboardTool,
} from "@leetcollab/contracts";
import { supabase } from "../lib/supabase";
import { useAuth } from "./auth-provider";
import { useSocket } from "./socket-provider";
import { ChatPanel } from "./room/chat-panel";
import { EditorPanel } from "./room/editor-panel";
import { type DifficultyFilter, ProblemPanel } from "./room/problem-panel";
import { RoomHeader } from "./room/room-header";
import { WorkspacePanel } from "./room/workspace-panel";
import type { PracticeExecution } from "./room/practice-result";
import { usePracticeDraft } from "./room/use-practice-draft";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

type WhiteboardMode = WhiteboardTool | "pan";
type WhiteboardViewport = { scale: number; offsetX: number; offsetY: number };
type WhiteboardCursor = { visible: boolean; x: number; y: number; diameter: number };
type CanvasPositionEvent = {
  currentTarget: HTMLCanvasElement;
  clientX: number;
  clientY: number;
};

const initialWhiteboardViewport: WhiteboardViewport = { scale: 1, offsetX: 0, offsetY: 0 };

function paintStroke(
  context: CanvasRenderingContext2D,
  stroke: WhiteboardStroke | WhiteboardStrokeInput,
) {
  if (stroke.points.length === 0) return;

  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color ?? "#000000";
  context.fillStyle = stroke.color ?? "#000000";
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";

  const [firstPoint, ...remainingPoints] = stroke.points;
  context.beginPath();

  if (remainingPoints.length === 0) {
    context.arc(firstPoint.x, firstPoint.y, stroke.size / 2, 0, Math.PI * 2);
    if (stroke.tool === "eraser") context.fill();
    else context.fill();
    return;
  }

  context.moveTo(firstPoint.x, firstPoint.y);
  remainingPoints.forEach((point) => context.lineTo(point.x, point.y));
  context.stroke();
}

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

function timerElapsedMs(timer: RoomTimer, now: number): number {
  if (timer.status !== "running" || !timer.startedAt) return timer.elapsedMs;
  return timer.elapsedMs + Math.max(0, now - Date.parse(timer.startedAt));
}

function formatTimer(timer: RoomTimer, now: number): string {
  const totalSeconds = Math.floor(timerElapsedMs(timer, now) / 1000);
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

type PendingCodeWrite = { replacement?: { code: string; resolve: () => void; reject: (error: Error) => void } };
type SharedCodeState = { roomId: string; problemId: string | null; pendingEdit: PendingCodeWrite | null };

export function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { session, loading } = useAuth();
  const socket = useSocket();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [execution, setExecution] = useState<{ scope: string; value: PracticeExecution } | null>(null);
  const executionScope = `${roomId}:${room?.problem?.id}:${session?.user.id}`;
  useEffect(() => { setExecution(null); }, [executionScope]);
  const [code, setCode] = useState("");
  const codeRef = useRef("");
  const sharedCode = useRef<SharedCodeState | null>(null);
  const [pendingCodeWrite, setPendingCodeWrite] = useState(false);
  const [codeSync, setCodeSync] = useState<"checking" | "failed" | null>(null);
  const reconcilingCode = codeSync !== null;
  const [codeVersion, setCodeVersion] = useState(0);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("Connecting to room…");
  const [drawing, setDrawing] = useState(false);
  const [problemCatalog, setProblemCatalog] = useState<Problem[]>([]);
  const [problemSearch, setProblemSearch] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("All");
  const [timerNow, setTimerNow] = useState(Date.now());
  const [whiteboardMode, setWhiteboardMode] = useState<WhiteboardMode>("pen");
  const [whiteboardColor, setWhiteboardColor] = useState("#4f46e5");
  const [whiteboardSize, setWhiteboardSize] = useState(3);
  const [whiteboardViewport, setWhiteboardViewport] = useState<WhiteboardViewport>(initialWhiteboardViewport);
  const [whiteboardCursor, setWhiteboardCursor] = useState<WhiteboardCursor>({
    visible: false,
    x: 0,
    y: 0,
    diameter: whiteboardSize,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeRef = useRef<WhiteboardStrokeInput | null>(null);
  const panPointRef = useRef<WhiteboardPoint | null>(null);

  function redrawWhiteboard(
    strokes = room?.whiteboard ?? [],
    previewStroke = activeStrokeRef.current,
  ) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(
      whiteboardViewport.scale,
      0,
      0,
      whiteboardViewport.scale,
      whiteboardViewport.offsetX,
      whiteboardViewport.offsetY,
    );
    strokes.forEach((stroke) => paintStroke(context, stroke));
    if (previewStroke) paintStroke(context, previewStroke);
    context.globalCompositeOperation = "source-over";
    context.restore();
  }

  useEffect(() => {
    if (!loading && !session) router.replace("/");
  }, [loading, router, session]);

  useEffect(() => {
    if (!session) return;

    supabase
      .from("problems")
      .select(problemSelect)
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) {
          setStatus(error.message);
          return;
        }

        setProblemCatalog(((data ?? []) as ProblemRow[]).map(normalizeProblem));
      });
  }, [session]);

  useEffect(() => {
    if (room?.timer.status !== "running") {
      setTimerNow(Date.now());
      return;
    }

    const intervalId = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [room?.timer.status, room?.timer.startedAt]);

  useEffect(() => {
    redrawWhiteboard();
  // `redrawWhiteboard` intentionally reads the current canvas and active preview stroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.whiteboard, whiteboardViewport]);

  useEffect(() => {
    if (!socket) return;
    const clearSharedCode = () => {
      sharedCode.current?.pendingEdit?.replacement?.reject(new Error("The shared room or exercise changed."));
      sharedCode.current = null;
    };
    const handleState = (state: RoomState) => {
      const problemId = state.problem?.id ?? null;
      if (sharedCode.current?.roomId !== state.roomId || sharedCode.current.problemId !== problemId) {
        clearSharedCode();
        sharedCode.current = { roomId: state.roomId, problemId, pendingEdit: null };
        setPendingCodeWrite(false);
        setCodeSync(null);
      }
      setRoom(state);
      receiveEditorCode(state.code);
      setStatus("");
    };
    const handleCode = (nextCode: string, replacement?: true) => receiveEditorCode(nextCode, replacement);
    const handleMessage = (nextMessage: RoomState["messages"][number]) => setRoom((current) => current ? { ...current, messages: [...current.messages, nextMessage] } : current);
    const handleStrokeAdded = (stroke: WhiteboardStroke) => {
      setRoom((current) => {
        if (!current || current.whiteboard.some((item) => item.id === stroke.id)) return current;
        return { ...current, whiteboard: [...current.whiteboard, stroke] };
      });
    };
    const handleUndo = (payload: { strokeId: string }) => {
      setRoom((current) => current
        ? { ...current, whiteboard: current.whiteboard.filter((stroke) => stroke.id !== payload.strokeId) }
        : current);
    };
    const handleClear = () => {
      activeStrokeRef.current = null;
      setRoom((current) => current ? { ...current, whiteboard: [] } : current);
    };
    const handleRoomLeft = (payload: { roomId: string }) => {
      if (payload.roomId === roomId) router.replace("/");
    };
    const joinRoom = () => {
      setStatus("Connecting to room...");
      socket.emit("room:join", { roomId }, (response) => {
        if (!response.ok) {
          if (response.code === "ALREADY_IN_ROOM" && response.currentRoomId) {
            router.replace(`/room/${response.currentRoomId}`);
            return;
          }

          if (response.code === "ROOM_NOT_FOUND") {
            setRoom(null);
            setStatus("This room ended or the realtime server restarted.");
            return;
          }

          setStatus(response.error);
          return;
        }

        handleState(response.data);
      });
    };
    const handleDisconnect = () => {
      clearSharedCode();
      setCodeSync("checking");
      setStatus("Connection interrupted. Reconnecting...");
    };

    socket.on("room:state", handleState);
    socket.on("code:updated", handleCode);
    socket.on("chat:message", handleMessage);
    socket.on("whiteboard:stroke:added", handleStrokeAdded);
    socket.on("whiteboard:undone", handleUndo);
    socket.on("whiteboard:cleared", handleClear);
    socket.on("room:left", handleRoomLeft);
    socket.on("connect", joinRoom);
    socket.on("disconnect", handleDisconnect);
    if (socket.connected) joinRoom();

    return () => {
      clearSharedCode();
      socket.off("room:state", handleState);
      socket.off("code:updated", handleCode);
      socket.off("chat:message", handleMessage);
      socket.off("whiteboard:stroke:added", handleStrokeAdded);
      socket.off("whiteboard:undone", handleUndo);
      socket.off("whiteboard:cleared", handleClear);
      socket.off("room:left", handleRoomLeft);
      socket.off("connect", joinRoom);
      socket.off("disconnect", handleDisconnect);
    };
  }, [roomId, router, socket]);

  const isHost = room?.hostUserId === session?.user.id;
  const currentMember = room?.members.find((member) => member.userId === session?.user.id);
  const canEditCode = isHost || currentMember?.permissions.canEditCode === true;
  const canDrawWhiteboard = isHost || currentMember?.permissions.canDrawWhiteboard === true;
  const canChat = isHost || currentMember?.permissions.canChat === true;
  const canChangeProblem = isHost || currentMember?.permissions.canChangeProblem === true;
  const draft = usePracticeDraft({ roomId, userId: session?.user.id, problem: room?.problem ?? null, code,
    canEditCode: canEditCode && !reconcilingCode, connected: socket?.connected ?? false, onCodeChange: updateCode, onCodeReplace: replaceSharedCode });
  const filteredProblems = problemCatalog.filter((problem) => {
    const matchesDifficulty = difficultyFilter === "All" || problem.difficulty === difficultyFilter;
    const search = problemSearch.trim().toLowerCase();
    const matchesSearch = !search
      || problem.title.toLowerCase().includes(search)
      || problem.slug.toLowerCase().includes(search)
      || problem.category.toLowerCase().includes(search);

    return matchesDifficulty && matchesSearch;
  });
  const timerDisplay = room ? formatTimer(room.timer, timerNow) : "00:00:00";
  const hostName = room?.members.find((member) => member.userId === room.hostUserId)?.username ?? "host";

  function leaveRoom() {
    if (!socket) return router.push("/");
    socket.emit("room:leave", { roomId }, () => router.push("/"));
  }

  function replaceEditorCode(nextCode: string, invalidate = false) {
    if (invalidate || nextCode !== codeRef.current) setCodeVersion(version => version + 1);
    codeRef.current = nextCode;
    setCode(nextCode);
  }

  function receiveEditorCode(nextCode: string, replacement = false) {
    const shared = sharedCode.current;
    if (!shared) return;
    if (!shared.pendingEdit) replaceEditorCode(nextCode, replacement);
    else if (replacement) setCodeVersion(version => version + 1);
  }

  function beginEditorWrite(shared: SharedCodeState, edit: PendingCodeWrite) {
    shared.pendingEdit = edit;
    setPendingCodeWrite(true);
  }

  function settleEditorWrite(shared: SharedCodeState, edit: PendingCodeWrite, authoritativeCode: string, replaced = false) {
    if (sharedCode.current !== shared || shared.pendingEdit !== edit) return;
    shared.pendingEdit = null;
    replaceEditorCode(authoritativeCode, replaced);
    setPendingCodeWrite(false);
    if (replaced) edit.replacement?.resolve();
    else edit.replacement?.reject(new Error("The shared code replacement could not be confirmed."));
  }

  function reconcileEditorWrite(shared: SharedCodeState, edit: PendingCodeWrite) {
    if (!socket?.connected || sharedCode.current !== shared || shared.pendingEdit !== edit) return;
    setCodeSync("checking");
    socket.timeout(3000).emit("code:current", { roomId: shared.roomId, problemId: shared.problemId }, (error, response) => {
      if (sharedCode.current !== shared || shared.pendingEdit !== edit) return;
      if (error || !response.ok) {
        setCodeSync("failed");
        return;
      }
      settleEditorWrite(shared, edit, response.data, response.data === edit.replacement?.code);
      setCodeSync(null);
    });
  }

  function retryCodeSync() {
    const shared = sharedCode.current;
    if (codeSync === "failed" && shared?.pendingEdit) reconcileEditorWrite(shared, shared.pendingEdit);
  }

  function updateCode(nextCode: string) {
    if (!canEditCode || reconcilingCode) return;
    const shared = sharedCode.current;
    if (!socket?.connected || !shared || shared.roomId !== roomId || shared.problemId !== (room?.problem?.id ?? null)) return;
    const edit: PendingCodeWrite = {};
    beginEditorWrite(shared, edit);
    replaceEditorCode(nextCode, true);
    socket.timeout(3000).emit("code:update", { roomId, problemId: shared.problemId, code: nextCode }, (error, response) => {
      if (error || !response.ok) return reconcileEditorWrite(shared, edit);
      settleEditorWrite(shared, edit, nextCode);
    });
  }

  async function replaceSharedCode(problemId: string, expectedCode: string, nextCode: string) {
    const shared = sharedCode.current;
    if (!socket?.connected || !shared || reconcilingCode || shared.roomId !== roomId || shared.problemId !== problemId) {
      throw new Error("Reconnect before replacing shared code.");
    }
    await new Promise<void>((resolve, reject) => {
      const edit: PendingCodeWrite = { replacement: { code: nextCode, resolve, reject } };
      beginEditorWrite(shared, edit);
      socket.timeout(3000).emit("code:replace", { roomId, problemId, expectedCode, code: nextCode }, (error, response) => {
        if (sharedCode.current !== shared || shared.pendingEdit !== edit) return;
        if (error) return reconcileEditorWrite(shared, edit);
        if (!response.ok) {
          edit.replacement = undefined;
          reject(new Error(response.error));
          return reconcileEditorWrite(shared, edit);
        }
        settleEditorWrite(shared, edit, nextCode, true);
      });
    });
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!canChat) {
      setStatus("You do not have permission to send chat messages.");
      return;
    }
    if (!message.trim() || !socket) return;
    socket.emit("chat:send", { roomId, body: message }, (response) => {
      if (response.ok) setMessage("");
      else setStatus(response.error);
    });
  }

  function screenPointFromEvent(event: CanvasPositionEvent): WhiteboardPoint {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height)),
    };
  }

  function cssPointFromEvent(event: CanvasPositionEvent): WhiteboardPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function worldPointFromEvent(event: CanvasPositionEvent): WhiteboardPoint {
    const point = screenPointFromEvent(event);
    return {
      x: (point.x - whiteboardViewport.offsetX) / whiteboardViewport.scale,
      y: (point.y - whiteboardViewport.offsetY) / whiteboardViewport.scale,
    };
  }

  function updateWhiteboardCursor(event: CanvasPositionEvent) {
    if (whiteboardMode === "pan" || !canDrawWhiteboard) {
      setWhiteboardCursor((current) => current.visible ? { ...current, visible: false } : current);
      return;
    }

    const point = cssPointFromEvent(event);
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const cssScale = rect.width / canvas.width;
    setWhiteboardCursor({
      visible: true,
      x: point.x,
      y: point.y,
      diameter: Math.max(6, whiteboardSize * whiteboardViewport.scale * cssScale),
    });
  }

  function updateWhiteboardZoom(factor: number, centerPoint?: WhiteboardPoint) {
    const canvas = canvasRef.current;
    const center = centerPoint ?? (canvas
      ? { x: canvas.width / 2, y: canvas.height / 2 }
      : { x: 400, y: 180 });

    setWhiteboardViewport((current) => {
      const nextScale = Math.min(4, Math.max(0.35, current.scale * factor));
      const worldX = (center.x - current.offsetX) / current.scale;
      const worldY = (center.y - current.offsetY) / current.scale;

      return {
        scale: nextScale,
        offsetX: center.x - worldX * nextScale,
        offsetY: center.y - worldY * nextScale,
      };
    });
  }

  function beginWhiteboardInteraction(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateWhiteboardCursor(event);

    if (whiteboardMode === "pan") {
      panPointRef.current = screenPointFromEvent(event);
      setDrawing(true);
      return;
    }

    if (!canDrawWhiteboard) return;
    const point = worldPointFromEvent(event);
    activeStrokeRef.current = {
      tool: whiteboardMode,
      color: whiteboardMode === "pen" ? whiteboardColor : null,
      size: whiteboardSize,
      points: [point],
    };
    setDrawing(true);
    redrawWhiteboard(room?.whiteboard ?? [], activeStrokeRef.current);
  }

  function updateWhiteboardInteraction(event: PointerEvent<HTMLCanvasElement>) {
    updateWhiteboardCursor(event);
    if (!drawing) return;

    if (whiteboardMode === "pan") {
      const previousPoint = panPointRef.current;
      const nextPoint = screenPointFromEvent(event);
      if (!previousPoint) return;

      setWhiteboardViewport((current) => ({
        ...current,
        offsetX: current.offsetX + nextPoint.x - previousPoint.x,
        offsetY: current.offsetY + nextPoint.y - previousPoint.y,
      }));
      panPointRef.current = nextPoint;
      return;
    }

    const activeStroke = activeStrokeRef.current;
    if (!activeStroke || !canDrawWhiteboard) return;
    const point = worldPointFromEvent(event);
    const previousPoint = activeStroke.points.at(-1);
    if (
      previousPoint
      && Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) < 1
    ) {
      return;
    }

    if (activeStroke.points.length < 2_000) {
      activeStroke.points.push(point);
      redrawWhiteboard(room?.whiteboard ?? [], activeStroke);
    }
  }

  function endWhiteboardInteraction() {
    if (!drawing) return;
    setDrawing(false);
    panPointRef.current = null;

    const activeStroke = activeStrokeRef.current;
    activeStrokeRef.current = null;

    if (!activeStroke) return;
    redrawWhiteboard(room?.whiteboard ?? [], null);

    if (!socket || !canDrawWhiteboard) return;
    socket.emit("whiteboard:stroke:add", { roomId, stroke: activeStroke }, (response) => {
      if (!response.ok) setStatus(response.error);
    });
  }

  function leaveWhiteboardCanvas() {
    setWhiteboardCursor((current) => ({ ...current, visible: false }));
    if (drawing) endWhiteboardInteraction();
  }

  function undoWhiteboard() {
    if (!socket || !canDrawWhiteboard) return;
    socket.emit("whiteboard:undo", { roomId }, (response) => {
      if (!response.ok) setStatus(response.error);
    });
  }

  function handleWhiteboardWheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const center = screenPointFromEvent(event);
    updateWhiteboardZoom(event.deltaY < 0 ? 1.12 : 0.88, center);
  }

  function clearWhiteboard() {
    if (!socket || !canDrawWhiteboard) return;
    socket.emit("whiteboard:clear", { roomId }, (response) => {
      if (!response.ok) setStatus(response.error);
    });
  }

  function selectProblem(problemId: string) {
    if (!socket || !canChangeProblem) {
      setStatus("You do not have permission to change the problem.");
      return;
    }
    if (problemId === room?.problem?.id) return;

    socket.emit("room:problem:set", { roomId, problemId }, (response) => {
      if (response.ok) setRoom(response.data);
      else setStatus(response.error);
    });
  }

  function selectPreviousProblem() {
    const candidates = filteredProblems.length > 0 ? filteredProblems : problemCatalog;
    if (candidates.length === 0) return;
    const currentIndex = candidates.findIndex((problem) => problem.id === room?.problem?.id);
    const nextIndex = currentIndex >= 0
      ? (currentIndex - 1 + candidates.length) % candidates.length
      : candidates.length - 1;
    selectProblem(candidates[nextIndex].id);
  }

  function selectNextProblem() {
    const candidates = filteredProblems.length > 0 ? filteredProblems : problemCatalog;
    if (candidates.length === 0) return;
    const currentIndex = candidates.findIndex((problem) => problem.id === room?.problem?.id);
    const nextIndex = (currentIndex + 1) % candidates.length;
    selectProblem(candidates[nextIndex].id);
  }

  function selectRandomProblem() {
    const candidates = filteredProblems.length > 0 ? filteredProblems : problemCatalog;
    if (candidates.length === 0) return;
    const currentProblemId = room?.problem?.id;
    const selectable = candidates.length > 1
      ? candidates.filter((problem) => problem.id !== currentProblemId)
      : candidates;
    const nextProblem = selectable[Math.floor(Math.random() * selectable.length)];
    selectProblem(nextProblem.id);
  }

  function updateTimer(action: "start" | "pause" | "reset") {
    if (!socket || !isHost) {
      setStatus("Only the room host can control the timer.");
      return;
    }

    const eventName = action === "start"
      ? "room:timer:start"
      : action === "pause"
        ? "room:timer:pause"
        : "room:timer:reset";

    socket.emit(eventName, { roomId }, (response) => {
      if (response.ok) {
        setRoom(response.data);
        setTimerNow(Date.now());
      } else {
        setStatus(response.error);
      }
    });
  }

  function updateMemberPermission(
    memberUserId: string,
    capability: keyof RoomPermissions,
    enabled: boolean,
  ) {
    if (!socket || !room) return;
    const member = room.members.find((item) => item.userId === memberUserId);
    if (!member) return;

    const previousRoom = room;
    const nextPermissions = {
      ...member.permissions,
      [capability]: enabled,
    };

    setRoom((current) => current
      ? {
        ...current,
        members: current.members.map((item) => item.userId === memberUserId
          ? { ...item, permissions: nextPermissions }
          : item),
      }
      : current);

    socket.emit("room:member:permissions:set", {
      roomId,
      memberUserId,
      permissions: nextPermissions,
    }, (response) => {
      if (response.ok) setRoom(response.data);
      else {
        setStatus(response.error);
        setRoom(previousRoom);
      }
    });
  }

  return <main className="room-page">
    <RoomHeader
      roomId={roomId}
      hostName={hostName}
      timerDisplay={timerDisplay}
      timerStatus={room?.timer.status ?? "idle"}
      canChangeProblem={canChangeProblem}
      canControlTimer={isHost === true}
      onPreviousProblem={selectPreviousProblem}
      onNextProblem={selectNextProblem}
      onStartTimer={() => updateTimer("start")}
      onPauseTimer={() => updateTimer("pause")}
      onResetTimer={() => updateTimer("reset")}
      onLeave={leaveRoom}
    />
    {(status || codeSync === "failed") && (
      <Alert className="room-alert" variant="destructive">
        <AlertDescription>
          {codeSync === "failed" ? <>
            <p>Shared code could not be confirmed. Sync it before editing or running code.</p>
            <Button type="button" size="sm" variant="outline" onClick={retryCodeSync}>Retry code sync</Button>
          </> : status}
        </AlertDescription>
      </Alert>
    )}
    {!room ? (
      <Card className="workspace-card loading-card">
        <Skeleton className="room-loading-line" />
        <span>Waiting for room state...</span>
      </Card>
    ) : <div className="room-workspace">
      <section className="problem-region">
        <ProblemPanel
          problem={room.problem}
          isHost={isHost}
          problems={problemCatalog}
          filteredProblems={filteredProblems}
          canChangeProblem={canChangeProblem}
          difficultyFilter={difficultyFilter}
          searchTerm={problemSearch}
          onDifficultyFilterChange={setDifficultyFilter}
          onSearchTermChange={setProblemSearch}
          onSelectProblem={selectProblem}
          onRandomProblem={selectRandomProblem}
        />
      </section>
      <section className="editor-region">
        <EditorPanel
          roomId={roomId}
          problemId={room.problem?.id ?? null}
          code={code}
          codeVersion={codeVersion}
          execution={execution?.scope === executionScope ? execution.value : null}
          canEditCode={canEditCode}
          pendingCodeWrite={pendingCodeWrite || room.roomId !== roomId}
          reconcilingCode={reconcilingCode}
          progress={draft.progress}
          progressStatus={draft.status}
          conflictingDraft={draft.conflictingDraft}
          waitingForDraftWrite={draft.waitingForDraftWrite}
          onRecoverConflict={draft.recoverConflict}
          onDiscardConflict={draft.discardConflict}
          isProgressLoading={draft.loading || draft.saving}
          isRetrievingSubmission={draft.retrieving}
          connected={socket?.connected ?? false}
          onCodeChange={draft.editCode}
          onResetCode={draft.resetCode}
          onRestoreDraft={draft.restoreDraft}
          onRetrieveSubmission={draft.retrieveSubmission}
          onExecutionChange={value => setExecution({ scope: executionScope, value })}
        />
      </section>
      <section className="workspace-region">
        <WorkspacePanel
          problem={room.problem}
          execution={execution?.scope === executionScope ? execution.value : null}
          canvasRef={canvasRef}
          canDrawWhiteboard={canDrawWhiteboard}
          drawing={drawing}
          whiteboardMode={whiteboardMode}
          whiteboardColor={whiteboardColor}
          whiteboardSize={whiteboardSize}
          whiteboardScale={whiteboardViewport.scale}
          whiteboardCursor={whiteboardCursor}
          onClearWhiteboard={clearWhiteboard}
          onUndoWhiteboard={undoWhiteboard}
          onModeChange={setWhiteboardMode}
          onColorChange={setWhiteboardColor}
          onSizeChange={setWhiteboardSize}
          onPointerDown={beginWhiteboardInteraction}
          onPointerMove={updateWhiteboardInteraction}
          onPointerEnd={endWhiteboardInteraction}
          onPointerLeave={leaveWhiteboardCanvas}
          onWheel={handleWhiteboardWheel}
          onZoomIn={() => updateWhiteboardZoom(1.2)}
          onZoomOut={() => updateWhiteboardZoom(0.8)}
          onResetView={() => setWhiteboardViewport(initialWhiteboardViewport)}
        />
      </section>
      <section className="conversation-region">
        <ChatPanel
          room={room}
          message={message}
          currentUserId={session?.user.id ?? ""}
          canChat={canChat}
          isHost={isHost}
          onMessageChange={setMessage}
          onSendMessage={sendMessage}
          onMemberPermissionChange={updateMemberPermission}
        />
      </section>
    </div>}
  </main>;
}
