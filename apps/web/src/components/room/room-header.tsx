import Link from "next/link";
import { ChevronLeft, ChevronRight, Code2, LogOut, Moon, Pause, Play, RotateCcw, Sun } from "lucide-react";
import { useTheme } from "../theme-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type RoomHeaderProps = {
  roomId: string;
  hostName: string;
  timerDisplay: string;
  timerStatus: "idle" | "running" | "paused";
  canChangeProblem: boolean;
  canControlTimer: boolean;
  onPreviousProblem: () => void;
  onNextProblem: () => void;
  onStartTimer: () => void;
  onPauseTimer: () => void;
  onResetTimer: () => void;
  onLeave: () => void;
};

export function RoomHeader({
  roomId,
  hostName,
  timerDisplay,
  timerStatus,
  canChangeProblem,
  canControlTimer,
  onPreviousProblem,
  onNextProblem,
  onStartTimer,
  onPauseTimer,
  onResetTimer,
  onLeave,
}: RoomHeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="room-header">
      <Link className="brand" href="/" aria-label="LeetCollab home">
        <span className="brand-icon"><Code2 aria-hidden="true" /></span>
        <span>LeetCollab</span>
      </Link>
      <nav className="problem-nav" aria-label="Problem navigation">
        <Button disabled={!canChangeProblem} onClick={onPreviousProblem} size="sm" variant="outline">
          <ChevronLeft aria-hidden="true" />
          Prev
        </Button>
        <Button disabled={!canChangeProblem} onClick={onNextProblem} size="sm" variant="outline">
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
      <div className="room-header-center">
        <div className="room-header-meta">
          <strong>Room ID: {roomId}</strong>
          <span>Host: {hostName}</span>
        </div>
        <div className="timer-cluster">
          <Badge aria-label="Timer" className="timer-pill" variant="secondary">{timerDisplay}</Badge>
          <div className="timer-actions" aria-label="Timer controls">
            {timerStatus === "running"
              ? (
                <Button disabled={!canControlTimer} onClick={onPauseTimer} size="sm" variant="secondary">
                  <Pause aria-hidden="true" />
                  Pause
                </Button>
              ) : (
                <Button disabled={!canControlTimer} onClick={onStartTimer} size="sm" variant="secondary">
                  <Play aria-hidden="true" />
                  Start
                </Button>
              )}
            <Button disabled={!canControlTimer} onClick={onResetTimer} size="sm" variant="ghost">
              <RotateCcw aria-hidden="true" />
              Reset
            </Button>
          </div>
        </div>
      </div>
      <div className="room-header-actions">
        <Button onClick={onLeave} size="sm" variant="outline">
          <LogOut aria-hidden="true" />
          Leave Room
        </Button>
        <Button aria-label="Toggle theme" onClick={toggleTheme} size="sm" variant="ghost">
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          {theme === "dark" ? "Light" : "Dark"}
        </Button>
      </div>
    </header>
  );
}
