import { TaggedError } from "better-result";

export type InvalidPathReason =
  | "contains_nul"
  | "empty_segment"
  | "must_be_absolute"
  | "root_not_allowed"
  | "traversal_segment";

export class InvalidPathError extends TaggedError("InvalidPathError")<{
  path: string;
  reason: InvalidPathReason;
  message: string;
}>() {
  constructor(args: { path: string; reason: InvalidPathReason }) {
    super({
      ...args,
      message: invalidPathMessage(args.path, args.reason),
    });
  }
}

export class PathNotFoundError extends TaggedError("PathNotFoundError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({
      ...args,
      message: `Workspace path not found: ${args.path}`,
    });
  }
}

export class PathAlreadyExistsError extends TaggedError("PathAlreadyExistsError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({
      ...args,
      message: `Workspace path already exists: ${args.path}`,
    });
  }
}

export class IsDirectoryError extends TaggedError("IsDirectoryError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({
      ...args,
      message: `Workspace path is a directory: ${args.path}`,
    });
  }
}

export class NotDirectoryError extends TaggedError("NotDirectoryError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({
      ...args,
      message: `Workspace path is not a directory: ${args.path}`,
    });
  }
}

export class DirectoryNotEmptyError extends TaggedError("DirectoryNotEmptyError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string }) {
    super({
      ...args,
      message: `Workspace directory is not empty: ${args.path}`,
    });
  }
}

export class RevisionNotFoundError extends TaggedError("RevisionNotFoundError")<{
  revisionId: string;
  message: string;
}>() {
  constructor(args: { revisionId: string }) {
    super({
      ...args,
      message: `Workspace revision not found: ${args.revisionId}`,
    });
  }
}

export type WorkspaceError =
  | DirectoryNotEmptyError
  | InvalidPathError
  | IsDirectoryError
  | NotDirectoryError
  | PathAlreadyExistsError
  | PathNotFoundError
  | RevisionNotFoundError;

export type WorkspaceMkdirError =
  | InvalidPathError
  | NotDirectoryError
  | PathAlreadyExistsError
  | PathNotFoundError;
export type WorkspaceWriteError = InvalidPathError | IsDirectoryError | NotDirectoryError | PathNotFoundError;
export type WorkspaceReadError = InvalidPathError | IsDirectoryError | PathNotFoundError | RevisionNotFoundError;
export type WorkspaceListError = InvalidPathError | NotDirectoryError | PathNotFoundError | RevisionNotFoundError;
export type WorkspaceDeleteError = InvalidPathError | DirectoryNotEmptyError | PathNotFoundError;
export type WorkspaceStatError = InvalidPathError | PathNotFoundError | RevisionNotFoundError;

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

export type RevisionNotFoundErrorDto = {
  tag: "RevisionNotFoundError";
  revisionId: string;
  message: string;
};

export type WorkspaceErrorDto =
  | DirectoryNotEmptyErrorDto
  | InvalidPathErrorDto
  | IsDirectoryErrorDto
  | NotDirectoryErrorDto
  | PathAlreadyExistsErrorDto
  | PathNotFoundErrorDto
  | RevisionNotFoundErrorDto;

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
            : E extends RevisionNotFoundError
              ? RevisionNotFoundErrorDto
              : never;

export function workspaceErrorToDto<E extends WorkspaceError>(error: E): ErrorDtoFor<E> {
  if (DirectoryNotEmptyError.is(error)) {
    return {
      tag: "DirectoryNotEmptyError",
      path: error.path,
      message: error.message,
    } as ErrorDtoFor<E>;
  }
  if (InvalidPathError.is(error)) {
    return {
      tag: "InvalidPathError",
      path: error.path,
      reason: error.reason,
      message: error.message,
    } as ErrorDtoFor<E>;
  }
  if (IsDirectoryError.is(error)) {
    return {
      tag: "IsDirectoryError",
      path: error.path,
      message: error.message,
    } as ErrorDtoFor<E>;
  }
  if (NotDirectoryError.is(error)) {
    return {
      tag: "NotDirectoryError",
      path: error.path,
      message: error.message,
    } as ErrorDtoFor<E>;
  }
  if (PathAlreadyExistsError.is(error)) {
    return {
      tag: "PathAlreadyExistsError",
      path: error.path,
      message: error.message,
    } as ErrorDtoFor<E>;
  }
  if (PathNotFoundError.is(error)) {
    return {
      tag: "PathNotFoundError",
      path: error.path,
      message: error.message,
    } as ErrorDtoFor<E>;
  }
  if (RevisionNotFoundError.is(error)) {
    return {
      tag: "RevisionNotFoundError",
      revisionId: error.revisionId,
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
    case "root_not_allowed":
      return "Workspace path must not be root";
    case "traversal_segment":
      return `Workspace path must not contain traversal segments: ${path}`;
  }
}
