import { TaggedError } from "better-result";

export type InvalidPathReason =
  | "contains_nul"
  | "empty_segment"
  | "must_be_absolute"
  | "must_be_relative"
  | "root_not_allowed"
  | "traversal_segment";

export class InvalidPathError extends TaggedError("InvalidPathError")<{
  path: string;
  reason: InvalidPathReason;
  message: string;
}>() {
  constructor(args: { path: string; reason: InvalidPathReason }) {
    super({ ...args, message: invalidPathMessage(args.path, args.reason) });
  }
}

export class PathNotFoundError extends TaggedError("PathNotFoundError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `Workspace path not found: ${args.path}` });
  }
}

export class PathAlreadyExistsError extends TaggedError("PathAlreadyExistsError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `Workspace path already exists: ${args.path}` });
  }
}

export class IsDirectoryError extends TaggedError("IsDirectoryError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `Workspace path is a directory: ${args.path}` });
  }
}

export class NotDirectoryError extends TaggedError("NotDirectoryError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `Workspace path is not a directory: ${args.path}` });
  }
}

export class DirectoryNotEmptyError extends TaggedError("DirectoryNotEmptyError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({ ...args, message: `Workspace directory is not empty: ${args.path}` });
  }
}

export class WorkspaceNotFoundError extends TaggedError("WorkspaceNotFoundError")<{
  workspaceName: string;
  message: string;
}>() {
  constructor(args: { workspaceName: string }) {
    super({ ...args, message: `Workspace not found: ${args.workspaceName}` });
  }
}

export class WorkspaceCopyNotFoundError extends TaggedError("WorkspaceCopyNotFoundError")<{
  copyId: string;
  message: string;
}>() {
  constructor(args: { copyId: string }) {
    super({ ...args, message: `Workspace copy not found: ${args.copyId}` });
  }
}

export class WorkspaceCopyStaleError extends TaggedError("WorkspaceCopyStaleError")<{
  copyId: string;
  baseRevisionId?: string;
  currentRevisionId?: string;
  message: string;
}>() {
  constructor(args: { copyId: string; baseRevisionId?: string; currentRevisionId?: string }) {
    super({ ...args, message: `Workspace copy is stale: ${args.copyId}` });
  }
}

export type WorkspaceError =
  | DirectoryNotEmptyError
  | InvalidPathError
  | IsDirectoryError
  | NotDirectoryError
  | PathAlreadyExistsError
  | PathNotFoundError
  | WorkspaceNotFoundError
  | WorkspaceCopyNotFoundError
  | WorkspaceCopyStaleError;

export type WorkspaceMkdirError = InvalidPathError | NotDirectoryError | PathAlreadyExistsError | PathNotFoundError;
export type WorkspaceWriteError = InvalidPathError | IsDirectoryError | NotDirectoryError | PathNotFoundError;
export type WorkspaceWriteTreeError = InvalidPathError | IsDirectoryError | NotDirectoryError;
export type WorkspaceReadError = InvalidPathError | IsDirectoryError | PathNotFoundError;
export type WorkspaceListError = InvalidPathError | NotDirectoryError | PathNotFoundError;
export type WorkspaceDeleteError = InvalidPathError | DirectoryNotEmptyError | PathNotFoundError;
export type WorkspaceStatError = InvalidPathError | PathNotFoundError;
export type WorkspaceCopyCreateError = WorkspaceNotFoundError;
export type WorkspaceCopyLookupError = WorkspaceCopyNotFoundError;
export type WorkspaceCopyFileError =
  | WorkspaceMkdirError
  | WorkspaceWriteError
  | WorkspaceWriteTreeError
  | WorkspaceReadError
  | WorkspaceListError
  | WorkspaceDeleteError
  | WorkspaceStatError
  | WorkspaceCopyNotFoundError;
export type WorkspaceApplyError = WorkspaceCopyNotFoundError | WorkspaceCopyStaleError | WorkspaceNotFoundError;
export type WorkspaceDiscardError = WorkspaceCopyNotFoundError;

export type InvalidPathErrorDto = {
  tag: "InvalidPathError";
  path: string;
  reason: InvalidPathReason;
  message: string;
};

export type PathNotFoundErrorDto = {
  tag: "PathNotFoundError";
  path: string;
  message: string;
};

export type PathAlreadyExistsErrorDto = {
  tag: "PathAlreadyExistsError";
  path: string;
  message: string;
};

export type IsDirectoryErrorDto = {
  tag: "IsDirectoryError";
  path: string;
  message: string;
};

export type NotDirectoryErrorDto = {
  tag: "NotDirectoryError";
  path: string;
  message: string;
};

export type DirectoryNotEmptyErrorDto = {
  tag: "DirectoryNotEmptyError";
  path: string;
  message: string;
};

export type WorkspaceNotFoundErrorDto = {
  tag: "WorkspaceNotFoundError";
  workspaceName: string;
  message: string;
};

export type WorkspaceCopyNotFoundErrorDto = {
  tag: "WorkspaceCopyNotFoundError";
  copyId: string;
  message: string;
};

export type WorkspaceCopyStaleErrorDto = {
  tag: "WorkspaceCopyStaleError";
  copyId: string;
  baseRevisionId?: string;
  currentRevisionId?: string;
  message: string;
};

export type WorkspaceErrorDto =
  | DirectoryNotEmptyErrorDto
  | InvalidPathErrorDto
  | IsDirectoryErrorDto
  | NotDirectoryErrorDto
  | PathAlreadyExistsErrorDto
  | PathNotFoundErrorDto
  | WorkspaceNotFoundErrorDto
  | WorkspaceCopyNotFoundErrorDto
  | WorkspaceCopyStaleErrorDto;

export type ErrorDtoFor<E extends WorkspaceError> = E extends DirectoryNotEmptyError
  ? DirectoryNotEmptyErrorDto
  : E extends InvalidPathError
    ? InvalidPathErrorDto
    : E extends IsDirectoryError
      ? IsDirectoryErrorDto
      : E extends NotDirectoryError
        ? NotDirectoryErrorDto
        : E extends PathAlreadyExistsError
          ? PathAlreadyExistsErrorDto
          : E extends PathNotFoundError
            ? PathNotFoundErrorDto
            : E extends WorkspaceNotFoundError
              ? WorkspaceNotFoundErrorDto
              : E extends WorkspaceCopyNotFoundError
                ? WorkspaceCopyNotFoundErrorDto
                : E extends WorkspaceCopyStaleError
                  ? WorkspaceCopyStaleErrorDto
                  : never;

export function workspaceErrorToDto<E extends WorkspaceError>(error: E): ErrorDtoFor<E> {
  if (DirectoryNotEmptyError.is(error)) {
    return { tag: "DirectoryNotEmptyError", path: error.path, message: error.message } as ErrorDtoFor<E>;
  }
  if (InvalidPathError.is(error)) {
    return { tag: "InvalidPathError", path: error.path, reason: error.reason, message: error.message } as ErrorDtoFor<E>;
  }
  if (IsDirectoryError.is(error)) {
    return { tag: "IsDirectoryError", path: error.path, message: error.message } as ErrorDtoFor<E>;
  }
  if (NotDirectoryError.is(error)) {
    return { tag: "NotDirectoryError", path: error.path, message: error.message } as ErrorDtoFor<E>;
  }
  if (PathAlreadyExistsError.is(error)) {
    return { tag: "PathAlreadyExistsError", path: error.path, message: error.message } as ErrorDtoFor<E>;
  }
  if (PathNotFoundError.is(error)) {
    return { tag: "PathNotFoundError", path: error.path, message: error.message } as ErrorDtoFor<E>;
  }
  if (WorkspaceNotFoundError.is(error)) {
    return { tag: "WorkspaceNotFoundError", workspaceName: error.workspaceName, message: error.message } as ErrorDtoFor<E>;
  }
  if (WorkspaceCopyNotFoundError.is(error)) {
    return { tag: "WorkspaceCopyNotFoundError", copyId: error.copyId, message: error.message } as ErrorDtoFor<E>;
  }
  if (WorkspaceCopyStaleError.is(error)) {
    return {
      tag: "WorkspaceCopyStaleError",
      copyId: error.copyId,
      ...(error.baseRevisionId ? { baseRevisionId: error.baseRevisionId } : {}),
      ...(error.currentRevisionId ? { currentRevisionId: error.currentRevisionId } : {}),
      message: error.message,
    } as ErrorDtoFor<E>;
  }

  const exhaustive: never = error;
  return exhaustive;
}

function invalidPathMessage(path: string, reason: InvalidPathReason): string {
  switch (reason) {
    case "contains_nul":
      return "Workspace path must not contain NUL bytes";
    case "empty_segment":
      return `Workspace path must not contain empty segments: ${path}`;
    case "must_be_absolute":
      return `Workspace path must be absolute: ${path}`;
    case "must_be_relative":
      return `Workspace path must be relative: ${path}`;
    case "root_not_allowed":
      return "Workspace path must not be root";
    case "traversal_segment":
      return `Workspace path must not contain traversal segments: ${path}`;
  }
}
