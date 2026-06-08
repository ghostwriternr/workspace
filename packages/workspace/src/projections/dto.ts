import type { ErrorDtoFor, WorkspaceError } from "../model/errors";
import { workspaceErrorToDto } from "../model/errors";

export type WorkspaceOk<T = void> = T extends void ? { status: "ok" } : { status: "ok"; value: T };

export type WorkspaceDtoError<E> = {
  status: "error";
  error: E;
};

export type WorkspaceDtoResult<T, E extends WorkspaceError> = WorkspaceOk<T> | WorkspaceDtoError<ErrorDtoFor<E>>;

export function toWorkspaceErrorDto<E extends WorkspaceError>(error: E): WorkspaceDtoError<ErrorDtoFor<E>> {
  return { status: "error", error: workspaceErrorToDto(error) };
}
