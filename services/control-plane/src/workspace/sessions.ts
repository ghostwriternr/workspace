import { Result } from "better-result";
import { SessionNotFoundError } from "./errors";
import { createRevisionFromHead } from "./revisions";
import type {
  WorkspaceSessionCommitResult,
  WorkspaceSessionDiscardResult,
  WorkspaceSessionInfo,
  WorkspaceSessionInfoResult,
} from "./rpc";

type SqlStorage = DurableObjectStorage["sql"];

type SessionRow = {
  id: string;
  created_at: number;
  state: "open" | "committed" | "discarded";
};

export function beginWorkspaceSession(storage: DurableObjectStorage): WorkspaceSessionInfo {
  const session: WorkspaceSessionInfo = {
    sessionId: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  storage.transactionSync(() => {
    const sql = storage.sql;
    sql.exec(
      `INSERT INTO sessions (id, created_at, state)
       VALUES (?, ?, 'open')`,
      session.sessionId,
      session.createdAt,
    );
    sql.exec(
      `INSERT INTO session_entries
       (session_id, path, parent_path, name, type, blob_key, size, created_at, updated_at)
       SELECT ?, path, parent_path, name, type, blob_key, size, created_at, updated_at
       FROM entries`,
      session.sessionId,
    );
  });

  return session;
}

export function requireOpenSession(sql: SqlStorage, sessionId: string): WorkspaceSessionInfoResult {
  const row = getSession(sql, sessionId);
  if (!row || row.state !== "open") {
    return Result.err(new SessionNotFoundError({ sessionId }));
  }

  return Result.ok({ sessionId: row.id, createdAt: row.created_at });
}

export function commitWorkspaceSession(storage: DurableObjectStorage, sessionId: string): WorkspaceSessionCommitResult {
  const sql = storage.sql;

  return storage.transactionSync(() => {
    const session = requireOpenSession(sql, sessionId);
    if (Result.isError(session)) {
      return Result.err(session.error);
    }

    sql.exec("DELETE FROM entries");
    sql.exec(
      `INSERT INTO entries
       (path, parent_path, name, type, blob_key, size, created_at, updated_at)
       SELECT path, parent_path, name, type, blob_key, size, created_at, updated_at
       FROM session_entries
       WHERE session_id = ?`,
      sessionId,
    );

    const result = createRevisionFromHead(sql);

    sql.exec("DELETE FROM session_entries WHERE session_id = ?", sessionId);
    sql.exec("UPDATE sessions SET state = 'committed' WHERE id = ?", sessionId);

    return result;
  });
}

export function discardWorkspaceSession(storage: DurableObjectStorage, sessionId: string): WorkspaceSessionDiscardResult {
  const sql = storage.sql;

  return storage.transactionSync(() => {
    const session = requireOpenSession(sql, sessionId);
    if (Result.isError(session)) {
      return Result.err(session.error);
    }

    sql.exec("DELETE FROM session_entries WHERE session_id = ?", sessionId);
    sql.exec("UPDATE sessions SET state = 'discarded' WHERE id = ?", sessionId);

    return Result.ok();
  });
}

function getSession(sql: SqlStorage, sessionId: string): SessionRow | null {
  return (
    sql
      .exec<SessionRow>("SELECT id, created_at, state FROM sessions WHERE id = ?", sessionId)
      .toArray()[0] ?? null
  );
}

