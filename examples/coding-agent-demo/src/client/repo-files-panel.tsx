import type { RepoState } from "../repo/state-controller";
import { UI_COPY } from "./ui-copy";

export function RepoFilesPanel({
  files,
  activeWorkingCopyId,
  onApplyWorkingCopy,
  onDiscardWorkingCopy,
}: {
  files: RepoState["files"];
  activeWorkingCopyId?: string;
  onApplyWorkingCopy(): void;
  onDiscardWorkingCopy(): void;
}) {
  return (
    <article className="panel files-panel">
      <div className="panel-heading">
        <p className="eyebrow">Passive state</p>
        <h2>{UI_COPY.filesTitle}</h2>
      </div>
      {activeWorkingCopyId ? (
        <div className="edit-actions">
          <span>{UI_COPY.activeWorkingCopyLabel}</span>
          <code>{activeWorkingCopyId}</code>
          <button type="button" onClick={onApplyWorkingCopy}>{UI_COPY.applyWorkingCopyAction}</button>
          <button type="button" className="secondary" onClick={onDiscardWorkingCopy}>{UI_COPY.discardWorkingCopyAction}</button>
        </div>
      ) : null}
      {files.length === 0 ? (
        <p className="empty">No repository files imported yet.</p>
      ) : (
        <ol className="file-list">
          {files.map((file) => (
            <li key={file.path}>
              <span className={file.type}>{file.type === "directory" ? "dir" : "file"}</span>
              <code>{file.path}</code>
              <small>{file.type}</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
