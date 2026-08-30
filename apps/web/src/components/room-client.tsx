"use client";

import { FormEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoomPermissions, RoomState, WhiteboardPoint } from "@leetcollab/contracts";
import { useAuth } from "./auth-provider";
import { useSocket } from "./socket-provider";
import { ChatPanel } from "./room/chat-panel";
import { EditorPanel } from "./room/editor-panel";
import { ProblemPanel } from "./room/problem-panel";
import { RoomHeader } from "./room/room-header";
import { WorkspacePanel } from "./room/workspace-panel";

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
  const { session, loading } = useAuth();
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
    if (!loading && !session) router.replace("/");
  }, [loading, router, session]);

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
      setStatus("Connection interrupted. Reconnecting...");
    };

    socket.on("room:state", handleState);
    socket.on("code:updated", handleCode);
    socket.on("chat:message", handleMessage);
    socket.on("whiteboard:drew", handleDraw);
    socket.on("whiteboard:cleared", handleClear);
    socket.on("room:left", handleRoomLeft);
    socket.on("connect", joinRoom);
    socket.on("disconnect", handleDisconnect);
    if (socket.connected) joinRoom();

    return () => {
      socket.off("room:state", handleState);
      socket.off("code:updated", handleCode);
      socket.off("chat:message", handleMessage);
      socket.off("whiteboard:drew", handleDraw);
      socket.off("whiteboard:cleared", handleClear);
      socket.off("room:left", handleRoomLeft);
      socket.off("connect", joinRoom);
      socket.off("disconnect", handleDisconnect);
    };
  // `redraw` intentionally reads the current canvas and does not need to resubscribe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, router, socket]);

  const isHost = room?.hostUserId === session?.user.id;
  const currentMember = room?.members.find((member) => member.userId === session?.user.id);
  const canEditCode = isHost || currentMember?.permissions.canEditCode === true;
  const canDrawWhiteboard = isHost || currentMember?.permissions.canDrawWhiteboard === true;
  const canChat = isHost || currentMember?.permissions.canChat === true;
  const hostName = room?.members.find((member) => member.userId === room.hostUserId)?.username ?? "host";

  function leaveRoom() {
    if (!socket) return router.push("/");
    socket.emit("room:leave", { roomId }, () => router.push("/"));
  }

  function updateCode(nextCode: string) {
    if (!canEditCode) return;
    setCode(nextCode);
    socket?.emit("code:update", { roomId, code: nextCode });
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
    if (!socket || !canDrawWhiteboard) return;
    const point = pointFromEvent(event, isNewStroke);
    const context = canvasRef.current?.getContext("2d");
    if (context) paint(context, point, lastPoint.current);
    lastPoint.current = point;
    socket.emit("whiteboard:draw", { roomId, point });
  }

  function clearWhiteboard() {
    if (!socket || !canDrawWhiteboard) return;
    socket.emit("whiteboard:clear", { roomId }, (response) => {
      if (!response.ok) setStatus(response.error);
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

    socket.emit("room:member:permissions:set", {
      roomId,
      memberUserId,
      permissions: {
        ...member.permissions,
        [capability]: enabled,
      },
    }, (response) => {
      if (response.ok) setRoom(response.data);
      else setStatus(response.error);
    });
  }

  return <main className="room-page">
    <RoomHeader roomId={roomId} hostName={hostName} onLeave={leaveRoom} />
    {status && <p className="error">{status}</p>}
    {!room ? <div className="workspace-card loading-card">Waiting for room state...</div> : <div className="room-workspace">
      <section className="problem-region">
        <ProblemPanel problem={room.problem} isHost={isHost} />
      </section>
      <section className="editor-region">
        <EditorPanel code={code} canEditCode={canEditCode} onCodeChange={updateCode} />
      </section>
      <section className="workspace-region">
        <WorkspacePanel
          canvasRef={canvasRef}
          canDrawWhiteboard={canDrawWhiteboard}
          drawing={drawing}
          onClearWhiteboard={clearWhiteboard}
          onDrawingChange={setDrawing}
          onDraw={draw}
          onStrokeEnd={() => {
            setDrawing(false);
            lastPoint.current = null;
          }}
        />
      </section>
      <section className="conversation-region">
        <ChatPanel
          room={room}
          message={message}
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
