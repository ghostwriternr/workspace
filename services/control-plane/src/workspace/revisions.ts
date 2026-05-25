import { Result } from "better-result";
import { RevisionNotFoundError } from "./errors";
import type { WorkspaceCommitResult, WorkspaceRevision } from "./rpc";

type SqlStorage = DurableObjectStorage["sql"];

type RevisionRow = {
  id: string;
  created_at: number;
};

export function createRevisionFromHead(sql: SqlStorage): WorkspaceCommitResult {
  const revision: WorkspaceRevision = {
    revisionId: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  sql.exec(
    "INSERT INTO revisions (id, created_at) VALUES (?, ?)",
    revision.revisionId,
    revision.createdAt,
  );
  sql.exec(
    `INSERT INTO revision_entries
     (revision_id, path, parent_path, name, type, blob_key, size, created_at, updated_at)
     SELECT ?, path, parent_path, name, type, blob_key, size, created_at, updated_at
     FROM entries`,
    revision.revisionId,
  );

  return Result.ok(revision);
}

export function requireRevision(
  sql: SqlStorage,
  revisionId: string | undefined,
): Result<string | undefined, RevisionNotFoundError> {
  if (!revisionId) {
    return Result.ok(undefined);
  }
  if (!getRevision(sql, revisionId)) {
    return Result.err(new RevisionNotFoundError({ revisionId }));
  }

  return Result.ok(revisionId);
}

function getRevision(sql: SqlStorage, revisionId: string): RevisionRow | null {
  return sql.exec<RevisionRow>("SELECT id, created_at FROM revisions WHERE id = ?", revisionId).toArray()[0] ?? null;
}
