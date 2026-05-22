import { Result } from "better-result";
import {
  InvalidPathError,
  IsDirectoryError,
  NotDirectoryError,
  PathNotFoundError,
  type WorkspaceDeleteError,
  type WorkspaceListError,
  type WorkspaceReadError,
  type WorkspaceWriteError,
} from "./workspace-error";
import type { WorkspaceEntry, WorkspaceStore } from "./workspace-store";

type DirectoryNode = {
  type: "directory";
  children: Map<string, TreeNode>;
};

type FileNode = {
  type: "file";
  contents: Uint8Array;
};

type TreeNode = DirectoryNode | FileNode;

export class MemoryWorkspace implements WorkspaceStore {
  readonly #root: DirectoryNode = { type: "directory", children: new Map() };

  async writeFile(
    path: string,
    contents: Uint8Array,
  ): Promise<Result<void, WorkspaceWriteError>> {
    const parsed = parseWorkspacePath(path, { allowRoot: false });
    if (Result.isError(parsed)) {
      return parsed;
    }

    const parent = this.#ensureDirectory(parsed.value.slice(0, -1));
    if (Result.isError(parent)) {
      return parent;
    }

    parent.value.children.set(lastSegment(parsed.value), {
      type: "file",
      contents: new Uint8Array(contents),
    });
    return Result.ok();
  }

  async readFile(path: string): Promise<Result<Uint8Array, WorkspaceReadError>> {
    const node = this.#getNode(path);
    if (Result.isError(node)) {
      return node;
    }
    if (node.value.type === "directory") {
      return Result.err(new IsDirectoryError({ path }));
    }

    return Result.ok(new Uint8Array(node.value.contents));
  }

  async list(path: string): Promise<Result<WorkspaceEntry[], WorkspaceListError>> {
    const node = this.#getNode(path);
    if (Result.isError(node)) {
      return node;
    }
    if (node.value.type === "file") {
      return Result.err(new NotDirectoryError({ path }));
    }

    return Result.ok(
      Array.from(node.value.children.entries())
        .map(([name, child]) => ({
          name,
          path: joinWorkspacePath(path, name),
          type: child.type,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  async delete(path: string): Promise<Result<void, WorkspaceDeleteError>> {
    const parsed = parseWorkspacePath(path, { allowRoot: false });
    if (Result.isError(parsed)) {
      return parsed;
    }

    const parent = this.#getDirectory(parsed.value.slice(0, -1), path);
    if (Result.isError(parent)) {
      return parent;
    }

    const name = lastSegment(parsed.value);
    const node = parent.value.children.get(name);
    if (!node) {
      return Result.err(new PathNotFoundError({ path }));
    }
    if (node.type === "directory") {
      return Result.err(new IsDirectoryError({ path }));
    }

    parent.value.children.delete(name);
    this.#pruneEmptyDirectories(parsed.value.slice(0, -1));
    return Result.ok();
  }

  #ensureDirectory(segments: string[]): Result<DirectoryNode, NotDirectoryError> {
    let current = this.#root;
    let currentPath = "/";

    for (const segment of segments) {
      const childPath = joinWorkspacePath(currentPath, segment);
      const child = current.children.get(segment);
      if (!child) {
        const directory: DirectoryNode = { type: "directory", children: new Map() };
        current.children.set(segment, directory);
        current = directory;
        currentPath = childPath;
        continue;
      }
      if (child.type === "file") {
        return Result.err(new NotDirectoryError({ path: childPath }));
      }
      current = child;
      currentPath = childPath;
    }

    return Result.ok(current);
  }

  #getNode(path: string): Result<TreeNode, InvalidPathError | NotDirectoryError | PathNotFoundError> {
    const parsed = parseWorkspacePath(path, { allowRoot: true });
    if (Result.isError(parsed)) {
      return parsed;
    }
    return this.#getNodeFromSegments(parsed.value, path);
  }

  #getNodeFromSegments(
    segments: string[],
    requestedPath: string,
  ): Result<TreeNode, NotDirectoryError | PathNotFoundError> {
    let current: TreeNode = this.#root;
    let currentPath = "/";

    for (const segment of segments) {
      const childPath = joinWorkspacePath(currentPath, segment);
      if (current.type === "file") {
        return Result.err(new NotDirectoryError({ path: currentPath }));
      }

      const child = current.children.get(segment);
      if (!child) {
        return Result.err(new PathNotFoundError({ path: requestedPath }));
      }
      current = child;
      currentPath = childPath;
    }

    return Result.ok(current);
  }

  #getDirectory(
    segments: string[],
    requestedPath: string,
  ): Result<DirectoryNode, NotDirectoryError | PathNotFoundError> {
    const node = this.#getNodeFromSegments(segments, requestedPath);
    if (Result.isError(node)) {
      return node;
    }
    if (node.value.type === "file") {
      return Result.err(new NotDirectoryError({ path: requestedPath }));
    }
    return Result.ok(node.value);
  }

  #pruneEmptyDirectories(segments: string[]): void {
    for (let length = segments.length; length > 0; length--) {
      const directorySegments = segments.slice(0, length);
      const directory = this.#getDirectory(directorySegments, pathFromSegments(directorySegments));
      if (Result.isError(directory) || directory.value.children.size > 0) {
        return;
      }

      const parentSegments = directorySegments.slice(0, -1);
      const parent = this.#getDirectory(parentSegments, pathFromSegments(parentSegments));
      if (Result.isError(parent)) {
        return;
      }
      parent.value.children.delete(lastSegment(directorySegments));
    }
  }
}

function parseWorkspacePath(
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

function joinWorkspacePath(parent: string, name: string): string {
  if (parent === "/") {
    return `/${name}`;
  }
  return `${parent}/${name}`;
}

function lastSegment(segments: string[]): string {
  return segments[segments.length - 1] ?? "";
}

function pathFromSegments(segments: string[]): string {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
