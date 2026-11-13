"use client";

import CodeMirror from "@uiw/react-codemirror";
import { java } from "@codemirror/lang-java";
import { PracticeControls } from "../practice-controls";
import { oneDark } from "@codemirror/theme-one-dark";
import { Download, Save } from "lucide-react";
import type { ProblemProgress } from "@leetcollab/contracts";
import { useTheme } from "../theme-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Textarea } from "../ui/textarea";

type EditorPanelProps = {
  problemId: string | null;
  code: string;
  canEditCode: boolean;
  progress: ProblemProgress | null;
  progressStatus: string;
  isProgressLoading: boolean;
  onCodeChange: (value: string) => void;
  onSaveDraft: () => void;
  onLoadDraft: () => void;
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
  onCodeChange,
  onSaveDraft,
  onLoadDraft,
}: EditorPanelProps) {
  const { theme } = useTheme();
  const hasDraft = Boolean(progress?.draftCode);

  return (
    <Card className="workspace-card editor-panel">
      <div className="panel-heading compact">
        <Badge variant="secondary">Java</Badge>
        <div className="editor-actions">
          <Button disabled={isProgressLoading} onClick={onSaveDraft} size="sm" variant="secondary">
            <Save aria-hidden="true" />
            Save draft
          </Button>
          <Button disabled={!canEditCode || !hasDraft || isProgressLoading} onClick={onLoadDraft} size="sm" variant="secondary">
            <Download aria-hidden="true" />
            Load draft
          </Button>
        </div>
      </div>
      {problemId && <PracticeControls problemId={problemId} code={code} />}
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
          <strong>{progress?.lastSavedAt ? "Draft saved" : "Not saved yet"}</strong>
          <p className="muted">
            Last saved: {formatDateTime(progress?.lastSavedAt ?? null)}
          </p>
        </div>
        {progress?.solvedAt && <div>
          <strong>Prior manual completion (unverified)</strong>
          <p className="muted">{formatDateTime(progress.solvedAt)}. With: {progress.solvedWith.map(member => member.username).join(", ") || "Solo"}.</p>
        </div>}
        {progressStatus && <p className="success">{progressStatus}</p>}
        {!canEditCode && <p className="muted">You can view this room's code, but loading a draft into the shared editor requires edit permission.</p>}
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
