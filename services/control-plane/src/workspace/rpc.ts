import { Result, type Result as BetterResult } from "better-result";
import {
  type ErrorDtoFor,
  type InvalidPathErrorDto,
  type IsDirectoryErrorDto,
  type NotDirectoryErrorDto,
  type PathNotFoundErrorDto,
  type WorkspaceDeleteError,
  type WorkspaceError,
  type WorkspaceListError,
  type WorkspaceReadError,
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

export type WorkspaceWriteRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<InvalidPathErrorDto | IsDirectoryErrorDto | NotDirectoryErrorDto>;
export type WorkspaceReadRpcResult =
  | WorkspaceOk<Uint8Array>
  | WorkspaceRpcError<InvalidPathErrorDto | IsDirectoryErrorDto | PathNotFoundErrorDto>;
export type WorkspaceListRpcResult =
  | WorkspaceOk<WorkspaceEntry[]>
  | WorkspaceRpcError<InvalidPathErrorDto | NotDirectoryErrorDto | PathNotFoundErrorDto>;
export type WorkspaceDeleteRpcResult =
  | WorkspaceOk
  | WorkspaceRpcError<InvalidPathErrorDto | IsDirectoryErrorDto | PathNotFoundErrorDto>;

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

export type WorkspaceWriteResult = BetterResult<void, WorkspaceWriteError>;
export type WorkspaceReadResult = BetterResult<Uint8Array, WorkspaceReadError>;
export type WorkspaceListResult = BetterResult<WorkspaceEntry[], WorkspaceListError>;
export type WorkspaceDeleteResult = BetterResult<void, WorkspaceDeleteError>;
