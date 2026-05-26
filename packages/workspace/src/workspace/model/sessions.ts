import { Result } from "better-result";
import { SessionConflictError, SessionNotFoundError } from "./errors";
import { bumpHeadVersion, getHeadVersion } from "../storage/head-state";
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
  base_head_version: number;
};

type OpenSessionRecord = {
  sessionId: string;
  createdAt: number;
  baseHeadVersion: number;
};

export function beginWorkspaceSession(storage: DurableObjectStorage): WorkspaceSessionInfo {
  const sessionId = crypto.randomUUID();
  const createdAt = Date.now();

  storage.transactionSync(() => {
    const sql = storage.sql;
    const version = getHeadVersion(sql);
    sql.exec(
      `INSERT INTO sessions (id, created_at, state, base_head_version)
       VALUES (?, ?, 'open', ?)`,
      sessionId,
      createdAt,
      version,
    );
    sql.exec(
      `INSERT INTO session_entries
       (session_id, path, parent_path, name, type, blob_key, size, created_at, updated_at)
       SELECT ?, path, parent_path, name, type, blob_key, size, created_at, updated_at
       FROM entries`,
      sessionId,
    );
  });

  return { sessionId, createdAt };
}

export function requireOpenSession(sql: SqlStorage, sessionId: string): WorkspaceSessionInfoResult {
  const session = requireOpenSessionRecord(sql, sessionId);
  if (Result.isError(session)) {
    return Result.err(session.error);
  }

  return Result.ok({
    sessionId: session.value.sessionId,
    createdAt: session.value.createdAt,
  });
}

export function commitWorkspaceSession(storage: DurableObjectStorage, sessionId: string): WorkspaceSessionCommitResult {
  const sql = storage.sql;

  return storage.transactionSync(() => {
    const session = requireOpenSessionRecord(sql, sessionId);
    if (Result.isError(session)) {
      return Result.err(session.error);
    }

    const currentHeadVersion = getHeadVersion(sql);
    if (currentHeadVersion !== session.value.baseHeadVersion) {
      return Result.err(
        new SessionConflictError({
          sessionId,
          baseHeadVersion: session.value.baseHeadVersion,
          currentHeadVersion,
        }),
      );
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
    bumpHeadVersion(sql);

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

function requireOpenSessionRecord(sql: SqlStorage, sessionId: string): Result<OpenSessionRecord, SessionNotFoundError> {
  const row = getSession(sql, sessionId);
  if (!row || row.state !== "open") {
    return Result.err(new SessionNotFoundError({ sessionId }));
  }

  return Result.ok({
    sessionId: row.id,
    createdAt: row.created_at,
    baseHeadVersion: row.base_head_version,
  });
}

function getSession(sql: SqlStorage, sessionId: string): SessionRow | null {
  return (
    sql
      .exec<SessionRow>("SELECT id, created_at, state, base_head_version FROM sessions WHERE id = ?", sessionId)
      .toArray()[0] ?? null
  );
}

