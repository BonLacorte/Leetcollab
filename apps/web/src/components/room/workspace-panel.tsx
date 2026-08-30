import { useState, type PointerEvent, type RefObject } from "react";

type WorkspaceTab = "testcases" | "result" | "whiteboard";

type WorkspacePanelProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canDrawWhiteboard: boolean;
  drawing: boolean;
  onClearWhiteboard: () => void;
  onDrawingChange: (drawing: boolean) => void;
  onDraw: (event: PointerEvent<HTMLCanvasElement>, isNewStroke: boolean) => void;
  onStrokeEnd: () => void;
};

export function WorkspacePanel({
  canvasRef,
  canDrawWhiteboard,
  drawing,
  onClearWhiteboard,
  onDrawingChange,
  onDraw,
  onStrokeEnd,
}: WorkspacePanelProps) {
  const [tab, setTab] = useState<WorkspaceTab>("whiteboard");

  return (
    <section className="workspace-card workspace-panel">
      <div className="tabs" role="tablist" aria-label="Workspace">
        <button className={tab === "testcases" ? "active" : ""} onClick={() => setTab("testcases")} type="button">Testcases</button>
        <button className={tab === "result" ? "active" : ""} onClick={() => setTab("result")} type="button">Result</button>
        <button className={tab === "whiteboard" ? "active" : ""} onClick={() => setTab("whiteboard")} type="button">Whiteboard</button>
      </div>

      {tab === "testcases" && (
        <div className="empty-panel">
          <strong>Case 1</strong>
          <p className="muted">Testcase details will appear with the problem workflow.</p>
        </div>
      )}

      {tab === "result" && (
        <div className="empty-panel">
          <strong>No run result yet</strong>
          <p className="muted">Execution output will appear after a safe runner is added.</p>
        </div>
      )}

      {tab === "whiteboard" && (
        <div className="whiteboard-shell">
          <div className="whiteboard-toolbar">
            <button className="secondary" disabled={!canDrawWhiteboard} type="button">Pen</button>
            <button className="secondary" disabled={!canDrawWhiteboard} onClick={onClearWhiteboard} type="button">Clear</button>
          </div>
          <canvas
            ref={canvasRef}
            width={800}
            height={360}
            style={{ cursor: canDrawWhiteboard ? "crosshair" : "not-allowed" }}
            onPointerDown={(event) => {
              if (!canDrawWhiteboard) return;
              onDrawingChange(true);
              event.currentTarget.setPointerCapture(event.pointerId);
              onDraw(event, true);
            }}
            onPointerMove={(event) => {
              if (drawing) onDraw(event, false);
            }}
            onPointerUp={onStrokeEnd}
            onPointerCancel={onStrokeEnd}
            onPointerLeave={() => {
              if (drawing) onStrokeEnd();
            }}
          />
        </div>
      )}
    </section>
  );
}
