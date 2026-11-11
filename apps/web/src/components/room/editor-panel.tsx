"use client";

import CodeMirror from "@uiw/react-codemirror";
import { java } from "@codemirror/lang-java";
import { PracticeControls } from "../practice-controls";
import { oneDark } from "@codemirror/theme-one-dark";
import type { ProblemProgress } from "@leetcollab/contracts";
import { useTheme } from "../theme-provider";

type EditorPanelProps = {
  problemId: string;
  code: string;
  canEditCode: boolean;
  progress: ProblemProgress | null;
  progressStatus: string;
  isProgressLoading: boolean;
  onCodeChange: (value: string) => void;
  onSaveDraft: () => void;
  onLoadDraft: () => void;
  onMarkSolved: () => void;
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
  onMarkSolved,
}: EditorPanelProps) {
  const { theme } = useTheme();
  const hasDraft = Boolean(progress?.draftCode);
  const solvedWith = progress?.solvedWith.map((member) => member.username).join(", ");

  return (
    <section className="workspace-card editor-panel">
      <div className="panel-heading compact">
        <span className="language-pill">Java</span>
        <div className="editor-actions">
          <button className="secondary" disabled={isProgressLoading} onClick={onSaveDraft} type="button">Save draft</button>
          <button className="secondary" disabled={!canEditCode || !hasDraft || isProgressLoading} onClick={onLoadDraft} type="button">Load draft</button>
          <button className="secondary" disabled={isProgressLoading} onClick={onMarkSolved} type="button">Mark solved</button>

        </div>
      </div>
      <PracticeControls problemId={problemId} code={code} />
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
          <strong>{progress?.solvedAt ? "Solved" : progress?.lastSavedAt ? "Draft saved" : "Not saved yet"}</strong>
          <p className="muted">
            Last saved: {formatDateTime(progress?.lastSavedAt ?? null)}
          </p>
        </div>
        {progress?.solvedAt && (
          <div>
            <strong>Solved with</strong>
            <p className="muted">{solvedWith || "Solo"}</p>
          </div>
        )}
        {progressStatus && <p className="success">{progressStatus}</p>}
        {!canEditCode && <p className="muted">You can view this room's code, but loading a draft into the shared editor requires edit permission.</p>}
      </div>
      <textarea
        aria-hidden="true"
        className="sr-only"
        readOnly
        value={code}
      />
    </section>
  );
}
