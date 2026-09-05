import { useState, type PointerEvent, type RefObject, type WheelEvent } from "react";
import type { Problem, WhiteboardTool } from "@leetcollab/contracts";

type WorkspaceTab = "testcases" | "result" | "whiteboard";
type WhiteboardMode = WhiteboardTool | "pan";

type WorkspacePanelProps = {
  problem: Problem | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canDrawWhiteboard: boolean;
  drawing: boolean;
  whiteboardMode: WhiteboardMode;
  whiteboardColor: string;
  whiteboardSize: number;
  whiteboardScale: number;
  onClearWhiteboard: () => void;
  onUndoWhiteboard: () => void;
  onModeChange: (mode: WhiteboardMode) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerEnd: () => void;
  onWheel: (event: WheelEvent<HTMLCanvasElement>) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
};

export function WorkspacePanel({
  problem,
  canvasRef,
  canDrawWhiteboard,
  drawing,
  whiteboardMode,
  whiteboardColor,
  whiteboardSize,
  whiteboardScale,
  onClearWhiteboard,
  onUndoWhiteboard,
  onModeChange,
  onColorChange,
  onSizeChange,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onWheel,
  onZoomIn,
  onZoomOut,
  onResetView,
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
        <div className="testcase-panel">
          {problem?.examples.length ? problem.examples.map((example, index) => (
            <div className="testcase-card" key={example.title}>
              <strong>Case {index + 1}: {example.title}</strong>
              <pre>Input: {example.input}{'\n'}Output: {example.output}</pre>
              {example.explanation && <p className="muted">{example.explanation}</p>}
            </div>
          )) : (
            <div className="empty-panel">
              <strong>No testcases yet</strong>
              <p className="muted">This problem does not have display examples.</p>
            </div>
          )}
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
            <div className="whiteboard-tool-group" aria-label="Whiteboard drawing tools">
              <button
                className={whiteboardMode === "pen" ? "secondary active-tool" : "secondary"}
                disabled={!canDrawWhiteboard}
                onClick={() => onModeChange("pen")}
                type="button"
              >
                Pen
              </button>
              <button
                className={whiteboardMode === "eraser" ? "secondary active-tool" : "secondary"}
                disabled={!canDrawWhiteboard}
                onClick={() => onModeChange("eraser")}
                type="button"
              >
                Eraser
              </button>
              <button
                className={whiteboardMode === "pan" ? "secondary active-tool" : "secondary"}
                onClick={() => onModeChange("pan")}
                type="button"
              >
                Pan
              </button>
            </div>
            <label className="whiteboard-control">
              <span>Color</span>
              <input
                aria-label="Pen color"
                disabled={!canDrawWhiteboard || whiteboardMode === "eraser"}
                type="color"
                value={whiteboardColor}
                onChange={(event) => onColorChange(event.target.value)}
              />
            </label>
            <label className="whiteboard-control whiteboard-size-control">
              <span>Size {whiteboardSize}px</span>
              <input
                aria-label="Stroke size"
                disabled={!canDrawWhiteboard}
                min={1}
                max={48}
                type="range"
                value={whiteboardSize}
                onChange={(event) => onSizeChange(Number(event.target.value))}
              />
            </label>
            <div className="whiteboard-tool-group" aria-label="Whiteboard history controls">
              <button className="secondary" disabled={!canDrawWhiteboard} onClick={onUndoWhiteboard} type="button">Undo</button>
              <button className="secondary" disabled={!canDrawWhiteboard} onClick={onClearWhiteboard} type="button">Clear</button>
            </div>
            <div className="whiteboard-tool-group" aria-label="Whiteboard viewport controls">
              <button className="secondary" onClick={onZoomOut} type="button">−</button>
              <span className="zoom-readout">{Math.round(whiteboardScale * 100)}%</span>
              <button className="secondary" onClick={onZoomIn} type="button">+</button>
              <button className="secondary" onClick={onResetView} type="button">Fit</button>
            </div>
          </div>
          <canvas
            ref={canvasRef}
            width={800}
            height={360}
            style={{
              cursor: whiteboardMode === "pan"
                ? drawing ? "grabbing" : "grab"
                : canDrawWhiteboard ? "crosshair" : "not-allowed",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onPointerLeave={() => {
              if (drawing) onPointerEnd();
            }}
            onWheel={onWheel}
          />
          {!canDrawWhiteboard && (
            <p className="muted whiteboard-permission-note">
              You can view the whiteboard, but drawing controls are disabled by room permissions.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
