"use client";

import CodeMirror from "@uiw/react-codemirror";
import { java } from "@codemirror/lang-java";
import { PracticeControls } from "../practice-controls";
import { oneDark } from "@codemirror/theme-one-dark";
import { History, RotateCcw } from "lucide-react";
import { useId } from "react";
import type { ProblemProgress } from "@leetcollab/contracts";
import { useTheme } from "../theme-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Textarea } from "../ui/textarea";
import type { PracticeExecution } from "./practice-result";

type EditorPanelProps = {
  problemId: string | null;
  code: string;
  canEditCode: boolean;
  progress: ProblemProgress | null;
  progressStatus: string;
  isProgressLoading: boolean;
  isRetrievingSubmission: boolean;
  connected: boolean;
  onCodeChange: (value: string) => void;
  onResetCode: () => void;
  onRetrieveSubmission: () => void;
  onExecutionChange: (execution: PracticeExecution) => void;
};

const extensions = [java()];

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function EditorPanel({
  problemId,
  code,
  canEditCode,
  progress,
  progressStatus,
  isProgressLoading,
  isRetrievingSubmission,
  connected,
  onCodeChange,
  onResetCode,
  onRetrieveSubmission,
  onExecutionChange,
}: EditorPanelProps) {
  const { theme } = useTheme();
  const tooltipId = useId();
  const actionsDisabled = !problemId || !canEditCode || !connected || isProgressLoading || isRetrievingSubmission;

  return (
    <Card className="workspace-card editor-panel">
      <div className="panel-heading compact">
        <Badge variant="secondary">Java</Badge>
        <div className="editor-actions">
          <span className="editor-tool">
            <Button aria-label="Reset to default code definition" aria-describedby={`${tooltipId}-reset`} disabled={actionsDisabled} onClick={onResetCode} size="icon" variant="secondary">
              <RotateCcw aria-hidden="true" />
            </Button>
            <span className="editor-tooltip" id={`${tooltipId}-reset`} role="tooltip">Reset to default code definition</span>
          </span>
          <span className="editor-tool">
            <Button aria-label="Retrieve last submitted code" aria-describedby={`${tooltipId}-retrieve`} disabled={actionsDisabled} onClick={onRetrieveSubmission} size="icon" variant="secondary">
              <History aria-hidden="true" />
            </Button>
            <span className="editor-tooltip" id={`${tooltipId}-retrieve`} role="tooltip">Retrieve last submitted code</span>
          </span>
        </div>
      </div>
      {problemId && <PracticeControls problemId={problemId} code={code} onExecutionChange={onExecutionChange} />}
      <div className="code-editor">
        <CodeMirror
          basicSetup={{ lineNumbers: true, foldGutter: true }}
          editable={canEditCode}
          extensions={extensions}
          height="100%"
          minHeight="260px"
          onChange={(value) => {
            if (canEditCode) onCodeChange(value);
          }}
          readOnly={!canEditCode}
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
    </Card>
  );
}
