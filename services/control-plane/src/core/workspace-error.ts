import { TaggedError } from "better-result";

export type InvalidPathReason =
  | "must_be_absolute"
  | "contains_nul"
  | "root_not_allowed"
  | "empty_segment"
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

export type WorkspaceError =
  | InvalidPathError
  | IsDirectoryError
  | NotDirectoryError
  | PathNotFoundError;

export type WorkspaceReadError = InvalidPathError | IsDirectoryError | NotDirectoryError | PathNotFoundError;
export type WorkspaceListError = InvalidPathError | NotDirectoryError | PathNotFoundError;
export type WorkspaceWriteError = InvalidPathError | NotDirectoryError;
export type WorkspaceDeleteError = InvalidPathError | IsDirectoryError | NotDirectoryError | PathNotFoundError;

function invalidPathMessage(path: string, reason: InvalidPathReason): string {
  switch (reason) {
    case "must_be_absolute":
      return `Workspace path must be absolute: ${path}`;
    case "contains_nul":
      return "Workspace path must not contain NUL bytes";
    case "root_not_allowed":
      return "Workspace path must not be root";
    case "empty_segment":
      return `Workspace path must not contain empty segments: ${path}`;
    case "traversal_segment":
      return `Workspace path must not contain traversal segments: ${path}`;
  }
}
