import type { RepoDirectoryState } from "../repo/state-controller";
import { UI_COPY } from "./ui-copy";

export function RepoFilesPanel({
  entries,
  path,
  activeWorkingCopyId,
  onApplyWorkingCopy,
  onDiscardWorkingCopy,
}: {
  entries: RepoDirectoryState["entries"];
  path: string;
  activeWorkingCopyId?: string;
  onApplyWorkingCopy(): void;
  onDiscardWorkingCopy(): void;
}) {
  return (
    <article className="panel files-panel">
      <div className="panel-heading">
        <p className="eyebrow">Passive state</p>
        <h2>{UI_COPY.filesTitle}</h2>
        <p className="directory-path">Showing <code>{path}</code></p>
      </div>
      {activeWorkingCopyId ? (
        <div className="edit-actions">
          <span>{UI_COPY.activeWorkingCopyLabel}</span>
          <code>{activeWorkingCopyId}</code>
          <button type="button" onClick={onApplyWorkingCopy}>{UI_COPY.applyWorkingCopyAction}</button>
          <button type="button" className="secondary" onClick={onDiscardWorkingCopy}>{UI_COPY.discardWorkingCopyAction}</button>
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p className="empty">No repository files imported yet.</p>
      ) : (
        <ol className="file-list">
          {entries.map((entry) => (
            <li key={entry.path}>
              <span className={entry.type}>{entry.type === "directory" ? "dir" : "file"}</span>
              <code>{entry.path}</code>
              <small>{entry.type}</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
