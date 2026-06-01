import type { RepoState } from "../repo/state-controller";
import { UI_COPY } from "./ui-copy";

export function RepoFilesPanel({
  files,
  activeEditId,
  onApplyEdit,
  onDiscardEdit,
}: {
  files: RepoState["files"];
  activeEditId?: string;
  onApplyEdit(): void;
  onDiscardEdit(): void;
}) {
  return (
    <article className="panel files-panel">
      <div className="panel-heading">
        <p className="eyebrow">Passive state</p>
        <h2>{UI_COPY.filesTitle}</h2>
      </div>
      {activeEditId ? (
        <div className="edit-actions">
          <span>{UI_COPY.activeEditLabel}</span>
          <code>{activeEditId}</code>
          <button type="button" onClick={onApplyEdit}>{UI_COPY.applyEditAction}</button>
          <button type="button" className="secondary" onClick={onDiscardEdit}>{UI_COPY.discardEditAction}</button>
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
