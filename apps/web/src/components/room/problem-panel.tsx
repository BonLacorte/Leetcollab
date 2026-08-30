import type { Problem } from "@leetcollab/contracts";

type ProblemPanelProps = {
  problem: Problem | null;
  isHost: boolean;
};

export function ProblemPanel({ problem, isHost }: ProblemPanelProps) {
  return (
    <article className="workspace-card problem-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Problem</p>
          <h1>{problem?.title ?? "Collaboration room"}</h1>
        </div>
        {problem && <span className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>}
      </div>
      <div className="problem-meta">
        <span>{problem?.slug ?? "room"}</span>
        <span>{isHost ? "Host" : "Participant"}</span>
      </div>
      <div className="problem-copy">
        <p>
          Work through the selected challenge together. Use the editor for code,
          the whiteboard for notes, and chat for quick discussion.
        </p>
        <h2>Local MVP</h2>
        <p>
          Code execution is intentionally unavailable for now, so treat this room as
          a live collaboration workspace.
        </p>
      </div>
    </article>
  );
}
