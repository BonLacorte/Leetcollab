"use client";

import CodeMirror, { type EditorView } from "@uiw/react-codemirror";
import { linter, lintGutter, setDiagnostics } from "@codemirror/lint";
import { java } from "@codemirror/lang-java";
import { PracticeControls } from "../practice-controls";
import { oneDark } from "@codemirror/theme-one-dark";
import { ChevronDown, ChevronUp, FileDown, History, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ProblemProgress } from "@leetcollab/contracts";
import { useTheme } from "../theme-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Textarea } from "../ui/textarea";
import type { PracticeExecution } from "./practice-result";
import { clearCompilerDiagnosticsOnEdit, editorDiagnostics } from "./editor-diagnostics";

type EditorPanelProps = {
  problemId: string | null;
  roomId?: string;
  code: string;
  codeVersion: number;
  execution: PracticeExecution | null;
  canEditCode: boolean;
  progress: ProblemProgress | null;
  progressStatus: string;
  conflictingDraft?: string | null;
  waitingForDraftWrite?: boolean;
  onRecoverConflict?: () => void;
  onDiscardConflict?: () => void;
  isProgressLoading: boolean;
  isRetrievingSubmission: boolean;
  connected: boolean;
  onCodeChange: (value: string) => void;
  onResetCode: () => void;
  onRestoreDraft: () => void;
  onRetrieveSubmission: () => void;
  onExecutionChange: (execution: PracticeExecution) => void;
};

const extensions = [java(), linter(null), lintGutter(), clearCompilerDiagnosticsOnEdit];

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function EditorPanel({
  problemId,
  roomId,
  code,
  codeVersion,
  execution,
  canEditCode,
  progress,
  progressStatus,
  conflictingDraft,
  waitingForDraftWrite,
  onRecoverConflict,
  onDiscardConflict,
  isProgressLoading,
  isRetrievingSubmission,
  connected,
  onCodeChange,
  onResetCode,
  onRestoreDraft,
  onRetrieveSubmission,
  onExecutionChange,
}: EditorPanelProps) {
  const { theme } = useTheme();
  const tooltipId = useId();
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [viewMode, setViewMode] = useState<"normal" | "maximized" | "folded">("normal");
  const pageScroll = useRef({ x: 0, y: 0 });
  const wasMaximized = useRef(false);
  const maximized = viewMode === "maximized";
  const folded = viewMode === "folded";
  useEffect(() => {
    editorView?.requestMeasure();
    if (wasMaximized.current && !maximized
      && (window.scrollX !== pageScroll.current.x || window.scrollY !== pageScroll.current.y)) {
      window.scrollTo(pageScroll.current.x, pageScroll.current.y);
    }
    wasMaximized.current = maximized;
  }, [editorView, viewMode, maximized]);
  useEffect(() => {
    if (!maximized) return;
    const restore = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setViewMode("normal");
      }
    };
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, [maximized]);
  useEffect(() => {
    if (editorView) editorView.dispatch(setDiagnostics(editorView.state, editorDiagnostics(editorView.state, execution, problemId, code, codeVersion)));
  }, [editorView, execution, problemId, code, codeVersion]);
  const editorEditable = canEditCode && !isRetrievingSubmission && !waitingForDraftWrite && conflictingDraft == null;
  const replacementUnavailable = !problemId || !canEditCode || !connected || isProgressLoading || isRetrievingSubmission;
  const actionsDisabled = replacementUnavailable || conflictingDraft != null;

  return (
    <Card className="workspace-card editor-panel" data-view={viewMode}>
      <div className="panel-heading compact editor-heading">
        <div className="editor-heading-title"><strong>Code</strong><Badge variant="secondary">Java</Badge></div>
        <div className="editor-actions">
          <span className="editor-tool">
            <Button aria-label="Reset to default code definition" aria-describedby={`${tooltipId}-reset`} disabled={actionsDisabled} onClick={onResetCode} size="icon" variant="secondary">
              <RotateCcw aria-hidden="true" />
            </Button>
            <span className="editor-tooltip" id={`${tooltipId}-reset`} role="tooltip">Reset to default code definition</span>
          </span>
          <span className="editor-tool">
            <Button aria-label="Restore saved draft to shared editor" aria-describedby={`${tooltipId}-draft`} disabled={actionsDisabled || !progress?.lastSavedAt || progress.draftLanguage !== "java"} onClick={onRestoreDraft} size="icon" variant="secondary">
              <FileDown aria-hidden="true" />
            </Button>
            <span className="editor-tooltip" id={`${tooltipId}-draft`} role="tooltip">Restore saved draft to shared editor</span>
          </span>
          <span className="editor-tool">
            <Button aria-label="Retrieve last submitted code" aria-describedby={`${tooltipId}-retrieve`} disabled={actionsDisabled} onClick={onRetrieveSubmission} size="icon" variant="secondary">
              <History aria-hidden="true" />
            </Button>
            <span className="editor-tooltip" id={`${tooltipId}-retrieve`} role="tooltip">Retrieve last submitted code</span>
          </span>
          <span className="editor-tool">
            <Button aria-label={maximized ? "Minimize Code card" : "Maximize Code card"} aria-describedby={`${tooltipId}-maximize`} aria-pressed={maximized} size="icon" variant="secondary" onClick={() => {
              if (!maximized) pageScroll.current = { x: window.scrollX, y: window.scrollY };
              setViewMode(maximized ? "normal" : "maximized");
            }}>
              {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </Button>
            <span className="editor-tooltip" id={`${tooltipId}-maximize`} role="tooltip">{maximized ? "Minimize Code card (Escape)" : "Maximize Code card"}</span>
          </span>
          <span className="editor-tool">
            <Button aria-label={folded ? "Unfold Code card" : "Fold Code card"} aria-describedby={`${tooltipId}-fold`} aria-expanded={!folded} aria-controls={`${tooltipId}-content`} size="icon" variant="secondary" onClick={() => setViewMode(folded ? "normal" : "folded")}>
              {folded ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
            </Button>
            <span className="editor-tooltip" id={`${tooltipId}-fold`} role="tooltip">{folded ? "Unfold Code card" : "Fold Code card"}</span>
          </span>
        </div>
      </div>
      <span className="sr-only" role="status">{maximized ? "Code card maximized. Press Escape to restore the workspace." : folded ? "Code card folded." : ""}</span>
      <div className="editor-content" id={`${tooltipId}-content`} hidden={folded}>
        {problemId && <PracticeControls problemId={problemId} roomId={roomId} code={code} codeVersion={codeVersion} onExecutionChange={value => {
          if (value.state === "running") setViewMode(current => current === "maximized" ? "normal" : current);
          onExecutionChange(value);
        }} />}
        <div className="code-editor">
          <CodeMirror
            basicSetup={{ lineNumbers: true, foldGutter: true }}
            editable={editorEditable}
            extensions={extensions}
            height="100%"
            minHeight="260px"
            onChange={(value) => {
              if (editorEditable) onCodeChange(value);
            }}
            onCreateEditor={setEditorView}
            readOnly={!editorEditable}
            theme={theme === "dark" ? oneDark : "light"}
            value={code}
          />
        </div>
        <div className="editor-progress">
          <div>
            <strong>{progress?.lastSavedAt ? "Draft autosaved" : "Not autosaved yet"}</strong>
            <p className="muted">
              Last saved: {formatDateTime(progress?.lastSavedAt ?? null)}
            </p>
          </div>
          {progress?.solvedAt && <div>
            <strong>Prior manual completion (unverified)</strong>
            <p className="muted">{formatDateTime(progress.solvedAt)}. With: {progress.solvedWith.map(member => member.username).join(", ") || "Solo"}.</p>
          </div>}
          {conflictingDraft != null && <div className="w-full space-y-2">
            <label>
              Recover or discard this unsaved draft to resume editing.
              <Textarea className="font-mono" readOnly value={conflictingDraft} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={replacementUnavailable} onClick={onRecoverConflict}>Recover into shared editor</Button>
              <Button variant="outline" size="sm" disabled={isProgressLoading || isRetrievingSubmission} onClick={onDiscardConflict}>Discard unsaved draft</Button>
            </div>
          </div>}
          {progressStatus && <p role="status">{progressStatus}</p>}
          {!canEditCode && <p className="muted">You can view this room's code. Restoring code requires edit permission.</p>}
        </div>
        <Textarea
          aria-hidden="true"
          className="sr-only"
          readOnly
          tabIndex={-1}
          value={code}
        />
      </div>
    </Card>
  );
}
