"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@leetcollab/contracts";
import { useAuth } from "./auth-provider";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const SocketContext = createContext<AppSocket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [socket, setSocket] = useState<AppSocket | null>(null);

  useEffect(() => {
    if (!session) {
      setSocket(null);
      return;
    }
    const nextSocket = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001", {
      auth: { token: session.access_token },
      transports: ["websocket"],
    });
    setSocket(nextSocket);
    return () => {
      nextSocket.disconnect();
    };
  }, [session]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
