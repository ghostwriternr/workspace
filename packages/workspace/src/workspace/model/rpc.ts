import { Result, type Result as BetterResult } from "better-result";
import {
  type DirectoryNotEmptyErrorDto,
  type ErrorDtoFor,
  type InvalidPathErrorDto,
  type IsDirectoryErrorDto,
  type NotDirectoryErrorDto,
  type PathAlreadyExistsErrorDto,
  type PathNotFoundErrorDto,
  type RevisionNotFoundErrorDto,
  type SessionConflictErrorDto,
  type SessionNotFoundErrorDto,
  type WorkspaceDeleteError,
  type WorkspaceError,
  type WorkspaceListError,
  type WorkspaceMkdirError,
  type WorkspaceReadError,
  type WorkspaceSessionCommitError,
  type WorkspaceSessionDeleteError,
  type WorkspaceSessionDiscardError,
  type WorkspaceSessionInfoError,
  type WorkspaceSessionListError,
  type WorkspaceSessionMkdirError,
  type WorkspaceSessionReadError,
  type WorkspaceSessionStatError,
  type WorkspaceSessionWriteError,
  type WorkspaceStatError,
  type WorkspaceWriteError,
  workspaceErrorToDto,
} from "./errors";
import type { WorkspaceSession } from "../runtime/workspace-session";

export type WorkspaceOk<T = void> = T extends void ? { status: "ok" } : { status: "ok"; value: T };

export type WorkspaceRpcError<E> = {
  status: "error";
  error: E;
};

export type WorkspaceRpcResult<T, E extends WorkspaceError> =
  | WorkspaceOk<T>
  | WorkspaceRpcError<ErrorDtoFor<E>>;

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export type WorkspaceStat = {
  path: string;
  type: "directory" | "file";
  size: number | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceRevision = {
  revisionId: string;
  createdAt: number;
};

export type WorkspaceSessionInfo = {
  sessionId: string;
  createdAt: number;
};

export type WorkspaceReadOptions = {
  revisionId?: string;
};

export type WorkspaceSnapshotRpcResult = WorkspaceRpcResult<WorkspaceRevision, never>;
export type WorkspaceMkdirRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<
      InvalidPathErrorDto | NotDirectoryErrorDto | PathAlreadyExistsErrorDto | PathNotFoundErrorDto
    >;
export type WorkspaceWriteRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<InvalidPathErrorDto | IsDirectoryErrorDto | NotDirectoryErrorDto | PathNotFoundErrorDto>;
export type WorkspaceReadRpcResult =
  | WorkspaceOk<Uint8Array>
  | WorkspaceRpcError<InvalidPathErrorDto | IsDirectoryErrorDto | PathNotFoundErrorDto | RevisionNotFoundErrorDto>;
export type WorkspaceListRpcResult =
  | WorkspaceOk<WorkspaceEntry[]>
  | WorkspaceRpcError<
      InvalidPathErrorDto | NotDirectoryErrorDto | PathNotFoundErrorDto | RevisionNotFoundErrorDto
    >;
export type WorkspaceDeleteRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<InvalidPathErrorDto | DirectoryNotEmptyErrorDto | PathNotFoundErrorDto>;
export type WorkspaceStatRpcResult =
  | WorkspaceOk<WorkspaceStat>
  | WorkspaceRpcError<InvalidPathErrorDto | PathNotFoundErrorDto | RevisionNotFoundErrorDto>;
export type WorkspaceSessionInfoRpcResult =
  | WorkspaceOk<WorkspaceSessionInfo>
  | WorkspaceRpcError<SessionNotFoundErrorDto>;
export type WorkspaceSessionLookupRpcResult =
  | WorkspaceOk<WorkspaceSession>
  | WorkspaceRpcError<SessionNotFoundErrorDto>;
export type WorkspaceSessionMkdirRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<
      InvalidPathErrorDto | NotDirectoryErrorDto | PathAlreadyExistsErrorDto | PathNotFoundErrorDto | SessionNotFoundErrorDto
    >;
export type WorkspaceSessionWriteRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<
      InvalidPathErrorDto | IsDirectoryErrorDto | NotDirectoryErrorDto | PathNotFoundErrorDto | SessionNotFoundErrorDto
    >;
export type WorkspaceSessionReadRpcResult =
  | WorkspaceOk<Uint8Array>
  | WorkspaceRpcError<InvalidPathErrorDto | IsDirectoryErrorDto | PathNotFoundErrorDto | SessionNotFoundErrorDto>;
export type WorkspaceSessionListRpcResult =
  | WorkspaceOk<WorkspaceEntry[]>
  | WorkspaceRpcError<InvalidPathErrorDto | NotDirectoryErrorDto | PathNotFoundErrorDto | SessionNotFoundErrorDto>;
export type WorkspaceSessionDeleteRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<InvalidPathErrorDto | DirectoryNotEmptyErrorDto | PathNotFoundErrorDto | SessionNotFoundErrorDto>;
export type WorkspaceSessionStatRpcResult =
  | WorkspaceOk<WorkspaceStat>
  | WorkspaceRpcError<InvalidPathErrorDto | PathNotFoundErrorDto | SessionNotFoundErrorDto>;
export type WorkspaceSessionCommitRpcResult =
  | WorkspaceOk<WorkspaceRevision>
  | WorkspaceRpcError<SessionConflictErrorDto | SessionNotFoundErrorDto>;
export type WorkspaceSessionDiscardRpcResult = WorkspaceOk | WorkspaceRpcError<SessionNotFoundErrorDto>;

export function toRpcResult<T, E extends WorkspaceError>(
  result: BetterResult<T, E>,
): WorkspaceRpcResult<T, E> {
  if (Result.isError(result)) {
    return toRpcError(result.error);
  }

  if (result.value === undefined) {
    return { status: "ok" } as WorkspaceRpcResult<T, E>;
  }

  return { status: "ok", value: result.value } as WorkspaceRpcResult<T, E>;
}

export function toRpcError<E extends WorkspaceError>(error: E): WorkspaceRpcError<ErrorDtoFor<E>> {
  return { status: "error", error: workspaceErrorToDto(error) };
}

export type WorkspaceSnapshotResult = BetterResult<WorkspaceRevision, never>;
export type WorkspaceMkdirResult = BetterResult<void, WorkspaceMkdirError>;
export type WorkspaceWriteResult = BetterResult<void, WorkspaceWriteError>;
export type WorkspaceReadResult = BetterResult<Uint8Array, WorkspaceReadError>;
export type WorkspaceListResult = BetterResult<WorkspaceEntry[], WorkspaceListError>;
export type WorkspaceDeleteResult = BetterResult<void, WorkspaceDeleteError>;
export type WorkspaceStatResult = BetterResult<WorkspaceStat, WorkspaceStatError>;
export type WorkspaceSessionInfoResult = BetterResult<WorkspaceSessionInfo, WorkspaceSessionInfoError>;
export type WorkspaceSessionMkdirResult = BetterResult<void, WorkspaceSessionMkdirError>;
export type WorkspaceSessionWriteResult = BetterResult<void, WorkspaceSessionWriteError>;
export type WorkspaceSessionReadResult = BetterResult<Uint8Array, WorkspaceSessionReadError>;
export type WorkspaceSessionListResult = BetterResult<WorkspaceEntry[], WorkspaceSessionListError>;
export type WorkspaceSessionDeleteResult = BetterResult<void, WorkspaceSessionDeleteError>;
export type WorkspaceSessionStatResult = BetterResult<WorkspaceStat, WorkspaceSessionStatError>;
export type WorkspaceSessionCommitResult = BetterResult<WorkspaceRevision, WorkspaceSessionCommitError>;
export type WorkspaceSessionDiscardResult = BetterResult<void, WorkspaceSessionDiscardError>;
