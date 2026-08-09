"use client";

import { FormEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomState, WhiteboardPoint } from "@leetcollab/contracts";
import { useAuth } from "./auth-provider";
import { useSocket } from "./socket-provider";

function paint(context: CanvasRenderingContext2D, point: WhiteboardPoint, previous: WhiteboardPoint | null) {
  context.strokeStyle = point.color;
  context.lineWidth = point.size;
  context.lineCap = "round";
  if (point.isNewStroke || !previous) {
    context.beginPath();
    context.moveTo(point.x, point.y);
  } else {
    context.lineTo(point.x, point.y);
    context.stroke();
  }
}

export function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { session } = useAuth();
  const socket = useSocket();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("Connecting to room…");
  const [drawing, setDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPoint = useRef<WhiteboardPoint | null>(null);

  function redraw(points: WhiteboardPoint[]) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    let previous: WhiteboardPoint | null = null;
    points.forEach((point) => { paint(context, point, previous); previous = point; });
    lastPoint.current = previous;
  }

  useEffect(() => {
    if (!session) router.replace("/");
  }, [router, session]);

  useEffect(() => {
    if (!socket) return;
    const handleState = (state: RoomState) => {
      setRoom(state);
      setCode(state.code);
      setStatus("");
      redraw(state.whiteboard);
    };
    const handleCode = (nextCode: string) => setCode(nextCode);
    const handleMessage = (nextMessage: RoomState["messages"][number]) => setRoom((current) => current ? { ...current, messages: [...current.messages, nextMessage] } : current);
    const handleDraw = (point: WhiteboardPoint) => {
      const context = canvasRef.current?.getContext("2d");
      if (context) paint(context, point, lastPoint.current);
      lastPoint.current = point;
    };
    const handleClear = () => {
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      lastPoint.current = null;
    };
    socket.on("room:state", handleState);
    socket.on("code:updated", handleCode);
    socket.on("chat:message", handleMessage);
    socket.on("whiteboard:drew", handleDraw);
    socket.on("whiteboard:cleared", handleClear);
    socket.emit("room:join", { roomId }, (response) => {
      if (!response.ok) setStatus(response.error);
      else handleState(response.data);
    });
    return () => {
      socket.off("room:state", handleState);
      socket.off("code:updated", handleCode);
      socket.off("chat:message", handleMessage);
      socket.off("whiteboard:drew", handleDraw);
      socket.off("whiteboard:cleared", handleClear);
    };
  // `redraw` intentionally reads the current canvas and does not need to resubscribe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, socket]);

  function leaveRoom() {
    if (!socket) return router.push("/");
    socket.emit("room:leave", { roomId }, () => router.push("/"));
  }

  function updateCode(nextCode: string) {
    setCode(nextCode);
    socket?.emit("code:update", { roomId, code: nextCode });
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || !socket) return;
    socket.emit("chat:send", { roomId, body: message }, (response) => {
      if (response.ok) setMessage("");
      else setStatus(response.error);
    });
  }

  function pointFromEvent(event: PointerEvent<HTMLCanvasElement>, isNewStroke: boolean): WhiteboardPoint {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height)),
      color: "#4f46e5",
      size: 3,
      isNewStroke,
    };
  }

  function draw(event: PointerEvent<HTMLCanvasElement>, isNewStroke: boolean) {
    if (!socket) return;
    const point = pointFromEvent(event, isNewStroke);
    const context = canvasRef.current?.getContext("2d");
    if (context) paint(context, point, lastPoint.current);
    lastPoint.current = point;
    socket.emit("whiteboard:draw", { roomId, point });
  }

  const isHost = room?.hostUserId === session?.user.id;

  return <main>
    <header className="topbar"><div><h1>{room?.problem?.title ?? "Collaboration room"}</h1><p className="muted">Room: {roomId}</p></div><button className="secondary" onClick={leaveRoom}>Leave room</button></header>
    {status && <p className="error">{status}</p>}
    {!room ? <div className="card">Waiting for room state…</div> : <div className="room">
      <section className="stack">
        <article className="card"><h2>{room.problem?.title}</h2><p className="muted">{room.problem?.difficulty} · Live-only room · {isHost ? "You are the host" : "Participant"}</p><p>Code execution is intentionally unavailable during the local MVP.</p></article>
        <section className="card stack"><h2>Shared editor</h2><textarea value={code} onChange={(event) => updateCode(event.target.value)} placeholder="Start solving together…" /></section>
        <section className="card stack"><div className="row"><h2 style={{ flex: 1 }}>Whiteboard</h2><button className="secondary" onClick={() => socket?.emit("whiteboard:clear", { roomId }, () => undefined)}>Clear</button></div><canvas ref={canvasRef} width={800} height={360} onPointerDown={(event) => { setDrawing(true); event.currentTarget.setPointerCapture(event.pointerId); draw(event, true); }} onPointerMove={(event) => { if (drawing) draw(event, false); }} onPointerUp={() => { setDrawing(false); lastPoint.current = null; }} /></section>
      </section>
      <aside className="stack">
        <section className="card"><h2>Members ({room.members.length})</h2>{room.members.map((member) => <p key={member.userId}>{member.username}{member.userId === room.hostUserId ? " · host" : ""}</p>)}</section>
        <section className="card stack"><h2>Chat</h2><div className="messages">{room.messages.length === 0 ? <p className="muted">No messages yet.</p> : room.messages.map((item) => <div className="message" key={item.id}><strong>{item.username}</strong><br />{item.body}</div>)}</div><form className="row" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Message the room" maxLength={2000} /><button>Send</button></form></section>
      </aside>
    </div>}
  </main>;
}

