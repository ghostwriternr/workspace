import { Result } from "better-result";
import { InvalidPathError } from "./errors";

export function parseWorkspacePath(
  path: string,
  options: { allowRoot: boolean },
): Result<string[], InvalidPathError> {
  if (!path.startsWith("/")) {
    return Result.err(new InvalidPathError({ path, reason: "must_be_absolute" }));
  }
  if (path === "/") {
    return options.allowRoot
      ? Result.ok([])
      : Result.err(new InvalidPathError({ path, reason: "root_not_allowed" }));
  }

  return parsePathSegments(path, path.slice(1));
}

export function parseRelativeWorkspacePath(path: string): Result<string[], InvalidPathError> {
  if (path.startsWith("/")) {
    return Result.err(new InvalidPathError({ path, reason: "must_be_relative" }));
  }

  return parsePathSegments(path, path);
}

export function workspacePathFromSegments(segments: string[]): string {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function parsePathSegments(originalPath: string, segmentText: string): Result<string[], InvalidPathError> {
  if (originalPath.includes("\0")) {
    return Result.err(new InvalidPathError({ path: originalPath, reason: "contains_nul" }));
  }

  const segments = segmentText.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return Result.err(new InvalidPathError({ path: originalPath, reason: "empty_segment" }));
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return Result.err(new InvalidPathError({ path: originalPath, reason: "traversal_segment" }));
  }

  return Result.ok(segments);
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === 0 ? "/" : path.slice(0, index);
}

export function nameFromPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
