import { useState, type PointerEvent, type RefObject, type WheelEvent } from "react";
import type { Problem, WhiteboardTool } from "@leetcollab/contracts";

type WorkspaceTab = "testcases" | "result" | "whiteboard";
type WhiteboardMode = WhiteboardTool | "pan";
type WhiteboardCursor = { visible: boolean; x: number; y: number; diameter: number };

type WorkspacePanelProps = {
  problem: Problem | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canDrawWhiteboard: boolean;
  drawing: boolean;
  whiteboardMode: WhiteboardMode;
  whiteboardColor: string;
  whiteboardSize: number;
  whiteboardScale: number;
  whiteboardCursor: WhiteboardCursor;
  onClearWhiteboard: () => void;
  onUndoWhiteboard: () => void;
  onModeChange: (mode: WhiteboardMode) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerEnd: () => void;
  onPointerLeave: () => void;
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
  whiteboardCursor,
  onClearWhiteboard,
  onUndoWhiteboard,
  onModeChange,
  onColorChange,
  onSizeChange,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onPointerLeave,
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
                aria-label="Pen"
                title="Pen"
                className={whiteboardMode === "pen" ? "secondary active-tool" : "secondary"}
                disabled={!canDrawWhiteboard}
                onClick={() => onModeChange("pen")}
                type="button"
              >
                <ToolIcon icon="pen" />
              </button>
              <button
                aria-label="Eraser"
                title="Eraser"
                className={whiteboardMode === "eraser" ? "secondary active-tool" : "secondary"}
                disabled={!canDrawWhiteboard}
                onClick={() => onModeChange("eraser")}
                type="button"
              >
                <ToolIcon icon="eraser" />
              </button>
              <button
                aria-label="Pan"
                title="Pan"
                className={whiteboardMode === "pan" ? "secondary active-tool" : "secondary"}
                onClick={() => onModeChange("pan")}
                type="button"
              >
                <ToolIcon icon="pan" />
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
              <button aria-label="Undo" title="Undo" className="secondary" disabled={!canDrawWhiteboard} onClick={onUndoWhiteboard} type="button">
                <ToolIcon icon="undo" />
              </button>
              <button aria-label="Clear" title="Clear" className="secondary" disabled={!canDrawWhiteboard} onClick={onClearWhiteboard} type="button">
                <ToolIcon icon="clear" />
              </button>
            </div>
            <div className="whiteboard-tool-group" aria-label="Whiteboard viewport controls">
              <button className="secondary" onClick={onZoomOut} type="button">−</button>
              <span className="zoom-readout">{Math.round(whiteboardScale * 100)}%</span>
              <button className="secondary" onClick={onZoomIn} type="button">+</button>
              <button className="secondary" onClick={onResetView} type="button">Fit</button>
            </div>
          </div>
          <div className="whiteboard-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={800}
              height={360}
              className={whiteboardMode === "pan" ? "whiteboard-pan-cursor" : "whiteboard-draw-cursor"}
              style={{
                cursor: whiteboardMode === "pan"
                  ? drawing ? "grabbing" : "grab"
                  : canDrawWhiteboard ? "none" : "not-allowed",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onPointerLeave={onPointerLeave}
              onWheel={onWheel}
            />
            {whiteboardCursor.visible && whiteboardMode !== "pan" && (
              <div
                aria-hidden="true"
                className={whiteboardMode === "eraser"
                  ? "whiteboard-cursor-preview eraser"
                  : "whiteboard-cursor-preview pen"}
                style={{
                  left: whiteboardCursor.x,
                  top: whiteboardCursor.y,
                  width: whiteboardCursor.diameter,
                  height: whiteboardCursor.diameter,
                  borderColor: whiteboardMode === "pen" ? whiteboardColor : undefined,
                  backgroundColor: whiteboardMode === "pen" ? `${whiteboardColor}22` : undefined,
                }}
              />
            )}
          </div>
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

function ToolIcon({ icon }: { icon: "pen" | "eraser" | "pan" | "undo" | "clear" }) {
  if (icon === "pen") {
    return (
      <svg aria-hidden="true" className="tool-icon" viewBox="0 0 24 24">
        <path d="M4 20l4.5-1 10.8-10.8a2.1 2.1 0 0 0 0-3L18.8 4.7a2.1 2.1 0 0 0-3 0L5 15.5 4 20z" />
        <path d="M14.5 6l3.5 3.5" />
      </svg>
    );
  }

  if (icon === "eraser") {
    return (
      <svg aria-hidden="true" className="tool-icon" viewBox="0 0 24 24">
        <path d="M4 15.5 12.5 7a2.4 2.4 0 0 1 3.4 0l2.1 2.1a2.4 2.4 0 0 1 0 3.4L11.5 19H7.6L4 15.5z" />
        <path d="M10 9.5 15.5 15" />
        <path d="M12 19h8" />
      </svg>
    );
  }

  if (icon === "pan") {
    return (
      <svg aria-hidden="true" className="tool-icon" viewBox="0 0 24 24">
        <path d="M12 3v18" />
        <path d="M3 12h18" />
        <path d="m8 7 4-4 4 4" />
        <path d="m8 17 4 4 4-4" />
        <path d="m7 8-4 4 4 4" />
        <path d="m17 8 4 4-4 4" />
      </svg>
    );
  }

  if (icon === "undo") {
    return (
      <svg aria-hidden="true" className="tool-icon" viewBox="0 0 24 24">
        <path d="M9 7H4v5" />
        <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="tool-icon" viewBox="0 0 24 24">
      <path d="M5 7h14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M8 7l1 13h6l1-13" />
      <path d="M9 7l1-3h4l1 3" />
    </svg>
  );
}
