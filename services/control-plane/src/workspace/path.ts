import { Result } from "better-result";
import { InvalidPathError } from "./errors";

export function parseWorkspacePath(
  path: string,
  options: { allowRoot: boolean },
): Result<string[], InvalidPathError> {
  if (!path.startsWith("/")) {
    return Result.err(new InvalidPathError({ path, reason: "must_be_absolute" }));
  }
  if (path.includes("\0")) {
    return Result.err(new InvalidPathError({ path, reason: "contains_nul" }));
  }
  if (path === "/") {
    return options.allowRoot
      ? Result.ok([])
      : Result.err(new InvalidPathError({ path, reason: "root_not_allowed" }));
  }

  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) {
    return Result.err(new InvalidPathError({ path, reason: "empty_segment" }));
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return Result.err(new InvalidPathError({ path, reason: "traversal_segment" }));
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

export function pathSegments(path: string): string[] {
  if (path === "/") {
    return [];
  }
  return path.slice(1).split("/");
}
