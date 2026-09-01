import { useTheme } from "../theme-provider";

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
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>LeetCollab</span>
      </div>
      <nav className="problem-nav" aria-label="Problem navigation">
        <button className="pill-button" disabled={!canChangeProblem} onClick={onPreviousProblem} type="button">Prev</button>
        <div className="timer-cluster">
          <div className="timer-pill" aria-label="Timer">{timerDisplay}</div>
          <div className="timer-actions" aria-label="Timer controls">
            {timerStatus === "running"
              ? <button className="mini-button" disabled={!canControlTimer} onClick={onPauseTimer} type="button">Pause</button>
              : <button className="mini-button" disabled={!canControlTimer} onClick={onStartTimer} type="button">Start</button>}
            <button className="mini-button" disabled={!canControlTimer} onClick={onResetTimer} type="button">Reset</button>
          </div>
        </div>
        <button className="pill-button" disabled={!canChangeProblem} onClick={onNextProblem} type="button">Next</button>
      </nav>
      <div className="room-header-meta">
        <strong>Room ID: {roomId}</strong>
        <span className="hide-small">Host: {hostName}</span>
      </div>
      <div className="room-header-actions">
        <button className="secondary" onClick={onLeave} type="button">Leave Room</button>
        <button className="icon-button" onClick={toggleTheme} type="button" aria-label="Toggle theme">
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </header>
  );
}
