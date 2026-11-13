import { useState, type PointerEvent, type RefObject, type WheelEvent } from "react";
import type { Problem, WhiteboardTool } from "@leetcollab/contracts";
import { Eraser, Maximize2, Move, PenLine, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

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
    <Card className="workspace-card workspace-panel">
      <Tabs className="workspace-tabs" onValueChange={(value) => setTab(value as WorkspaceTab)} value={tab}>
        <TabsList aria-label="Workspace">
          <TabsTrigger value="testcases">Testcases</TabsTrigger>
          <TabsTrigger value="result">Result</TabsTrigger>
          <TabsTrigger value="whiteboard">Whiteboard</TabsTrigger>
        </TabsList>

        <TabsContent className="testcase-panel" value="testcases">
          {problem?.examples.length ? problem.examples.map((example, index) => (
            <Card className="testcase-card" key={example.title}>
              <strong>Case {index + 1}: {example.title}</strong>
              <pre>Input: {example.input}{'\n'}Output: {example.output}</pre>
              {example.explanation && <p className="muted">{example.explanation}</p>}
            </Card>
          )) : (
            <div className="empty-panel">
              <strong>No testcases yet</strong>
              <p className="muted">This problem does not have display examples.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent className="empty-panel" value="result">
          <strong>No run result yet</strong>
          <p className="muted">Execution output will appear after a safe runner is added.</p>
        </TabsContent>

        <TabsContent className="whiteboard-shell" value="whiteboard">
          <div className="whiteboard-toolbar">
            <div className="whiteboard-tool-group" aria-label="Whiteboard drawing tools">
              <Button
                aria-label="Pen"
                title="Pen"
                disabled={!canDrawWhiteboard}
                onClick={() => onModeChange("pen")}
                size="icon"
                variant={whiteboardMode === "pen" ? "default" : "outline"}
              >
                <PenLine aria-hidden="true" />
              </Button>
              <Button
                aria-label="Eraser"
                title="Eraser"
                disabled={!canDrawWhiteboard}
                onClick={() => onModeChange("eraser")}
                size="icon"
                variant={whiteboardMode === "eraser" ? "default" : "outline"}
              >
                <Eraser aria-hidden="true" />
              </Button>
              <Button
                aria-label="Pan"
                title="Pan"
                onClick={() => onModeChange("pan")}
                size="icon"
                variant={whiteboardMode === "pan" ? "default" : "outline"}
              >
                <Move aria-hidden="true" />
              </Button>
            </div>
            <label className="whiteboard-control">
              <span>Color</span>
              <Input
                aria-label="Pen color"
                disabled={!canDrawWhiteboard || whiteboardMode === "eraser"}
                type="color"
                value={whiteboardColor}
                onChange={(event) => onColorChange(event.target.value)}
              />
            </label>
            <label className="whiteboard-control whiteboard-size-control">
              <span>Size {whiteboardSize}px</span>
              <Input
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
              <Button aria-label="Undo" title="Undo" disabled={!canDrawWhiteboard} onClick={onUndoWhiteboard} size="icon" variant="outline">
                <Undo2 aria-hidden="true" />
              </Button>
              <Button aria-label="Clear" title="Clear" disabled={!canDrawWhiteboard} onClick={onClearWhiteboard} size="icon" variant="outline">
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            <div className="whiteboard-tool-group" aria-label="Whiteboard viewport controls">
              <Button aria-label="Zoom out" onClick={onZoomOut} size="icon" variant="outline"><ZoomOut aria-hidden="true" /></Button>
              <span className="zoom-readout">{Math.round(whiteboardScale * 100)}%</span>
              <Button aria-label="Zoom in" onClick={onZoomIn} size="icon" variant="outline"><ZoomIn aria-hidden="true" /></Button>
              <Button onClick={onResetView} size="sm" variant="outline"><Maximize2 aria-hidden="true" />Fit</Button>
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
        </TabsContent>
      </Tabs>
    </Card>
  );
}
