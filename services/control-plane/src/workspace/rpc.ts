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
  type WorkspaceDeleteError,
  type WorkspaceError,
  type WorkspaceListError,
  type WorkspaceMkdirError,
  type WorkspaceReadError,
  type WorkspaceStatError,
  type WorkspaceWriteError,
  workspaceErrorToDto,
} from "./errors";

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

export type WorkspaceReadOptions = {
  revisionId?: string;
};

export type WorkspaceCommitRpcResult = WorkspaceRpcResult<WorkspaceRevision, never>;
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

export function toRpcResult<T, E extends WorkspaceError>(
  result: BetterResult<T, E>,
): WorkspaceRpcResult<T, E> {
  if (Result.isError(result)) {
    return { status: "error", error: workspaceErrorToDto(result.error) };
  }

  if (result.value === undefined) {
    return { status: "ok" } as WorkspaceRpcResult<T, E>;
  }

  return { status: "ok", value: result.value } as WorkspaceRpcResult<T, E>;
}

export type WorkspaceCommitResult = BetterResult<WorkspaceRevision, never>;
export type WorkspaceMkdirResult = BetterResult<void, WorkspaceMkdirError>;
export type WorkspaceWriteResult = BetterResult<void, WorkspaceWriteError>;
export type WorkspaceReadResult = BetterResult<Uint8Array, WorkspaceReadError>;
export type WorkspaceListResult = BetterResult<WorkspaceEntry[], WorkspaceListError>;
export type WorkspaceDeleteResult = BetterResult<void, WorkspaceDeleteError>;
export type WorkspaceStatResult = BetterResult<WorkspaceStat, WorkspaceStatError>;
