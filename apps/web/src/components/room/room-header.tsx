import { useTheme } from "../theme-provider";

type RoomHeaderProps = {
  roomId: string;
  hostName: string;
  onLeave: () => void;
};

export function RoomHeader({ roomId, hostName, onLeave }: RoomHeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="room-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>LeetCollab</span>
      </div>
      <nav className="problem-nav" aria-label="Problem navigation">
        <button className="pill-button" disabled type="button">Prev</button>
        <div className="timer-pill" aria-label="Timer">00:00:00</div>
        <button className="pill-button" disabled type="button">Next</button>
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
