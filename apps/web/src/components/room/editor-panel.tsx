type EditorPanelProps = {
  code: string;
  canEditCode: boolean;
  onCodeChange: (value: string) => void;
};

export function EditorPanel({ code, canEditCode, onCodeChange }: EditorPanelProps) {
  return (
    <section className="workspace-card editor-panel">
      <div className="panel-heading compact">
        <span className="language-pill">JavaScript</span>
        <div className="editor-actions">
          <button className="secondary" disabled type="button">Submit</button>
          <button className="secondary" disabled type="button">Run</button>
        </div>
      </div>
      <textarea
        className="code-editor"
        value={code}
        disabled={!canEditCode}
        onChange={(event) => onCodeChange(event.target.value)}
        placeholder={canEditCode ? "Start solving together..." : "You do not have editor permission."}
      />
    </section>
  );
}
