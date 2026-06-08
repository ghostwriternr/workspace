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

export class SessionNotFoundError extends TaggedError("SessionNotFoundError")<{
  sessionId: string;
  message: string;
}>() {
  constructor(args: { sessionId: string }) {
    super({ ...args, message: `Workspace session not found: ${args.sessionId}` });
  }
}

export type WorkspaceError =
  | DirectoryNotEmptyError
  | InvalidPathError
  | IsDirectoryError
  | NotDirectoryError
  | PathAlreadyExistsError
  | PathNotFoundError
  | SessionNotFoundError;

export type WorkspaceMkdirError = InvalidPathError | NotDirectoryError | PathAlreadyExistsError | PathNotFoundError;
export type WorkspaceWriteError = InvalidPathError | IsDirectoryError | NotDirectoryError | PathNotFoundError;
export type WorkspaceWriteTreeError = InvalidPathError | IsDirectoryError | NotDirectoryError;
export type WorkspaceReadError = InvalidPathError | IsDirectoryError | PathNotFoundError;
export type WorkspaceListError = InvalidPathError | NotDirectoryError | PathNotFoundError;
export type WorkspaceDeleteError = InvalidPathError | DirectoryNotEmptyError | PathNotFoundError;
export type WorkspaceStatError = InvalidPathError | PathNotFoundError;
export type WorkspaceSessionInfoError = SessionNotFoundError;
export type WorkspaceSessionMkdirError = WorkspaceMkdirError | SessionNotFoundError;
export type WorkspaceSessionWriteError = WorkspaceWriteError | SessionNotFoundError;
export type WorkspaceSessionWriteTreeError = WorkspaceWriteTreeError | SessionNotFoundError;
export type WorkspaceSessionReadError = WorkspaceReadError | SessionNotFoundError;
export type WorkspaceSessionListError = WorkspaceListError | SessionNotFoundError;
export type WorkspaceSessionDeleteError = WorkspaceDeleteError | SessionNotFoundError;
export type WorkspaceSessionStatError = WorkspaceStatError | SessionNotFoundError;
export type WorkspaceSessionCommitError = SessionNotFoundError;
export type WorkspaceSessionDiscardError = SessionNotFoundError;

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

export type SessionNotFoundErrorDto = {
  tag: "SessionNotFoundError";
  sessionId: string;
  message: string;
};

export type WorkspaceErrorDto =
  | DirectoryNotEmptyErrorDto
  | InvalidPathErrorDto
  | IsDirectoryErrorDto
  | NotDirectoryErrorDto
  | PathAlreadyExistsErrorDto
  | PathNotFoundErrorDto
  | SessionNotFoundErrorDto;

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
            : E extends SessionNotFoundError
              ? SessionNotFoundErrorDto
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
  if (SessionNotFoundError.is(error)) {
    return { tag: "SessionNotFoundError", sessionId: error.sessionId, message: error.message } as ErrorDtoFor<E>;
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
