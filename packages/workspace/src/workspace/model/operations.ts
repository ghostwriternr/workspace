import { Result } from "better-result";
import {
  DirectoryNotEmptyError,
  IsDirectoryError,
  NotDirectoryError,
  PathAlreadyExistsError,
  PathNotFoundError,
  type WorkspaceWriteError,
} from "./errors";
import { parentPath, parseWorkspacePath } from "./path";
import type {
  WorkspaceDeleteResult,
  WorkspaceListResult,
  WorkspaceMkdirResult,
  WorkspaceReadResult,
  WorkspaceStat,
  WorkspaceStatResult,
  WorkspaceWriteResult,
} from "./rpc";
import type { BlobRef, EntryRow, MutableTree, ReadableTree } from "../storage/tree";
import type { WorkspaceBlobStore } from "../storage/blob-store";

export function mkdirInTree(tree: MutableTree, path: string): WorkspaceMkdirResult {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return Result.err(parsed.error);
  }

  const parent = requireParentDirectory(tree, path);
  if (Result.isError(parent)) {
    return Result.err(parent.error);
  }

  if (tree.getEntry(path)) {
    return Result.err(new PathAlreadyExistsError({ path }));
  }

  tree.putDirectory(path, Date.now());
  return Result.ok();
}

export function validateWriteTarget(tree: MutableTree, path: string): Result<void, WorkspaceWriteError> {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return Result.err(parsed.error);
  }

  const parent = requireParentDirectory(tree, path);
  if (Result.isError(parent)) {
    return parent;
  }

  const existingEntry = tree.getEntry(path);
  if (existingEntry?.type === "directory") {
    return Result.err(new IsDirectoryError({ path }));
  }

  return Result.ok();
}

export function writeBlobRefToTree(tree: MutableTree, path: string, blob: BlobRef): WorkspaceWriteResult {
  // Revalidate after the caller's blob I/O boundary so metadata writes use current tree state.
  const validation = validateWriteTarget(tree, path);
  if (Result.isError(validation)) {
    return Result.err(validation.error);
  }

  tree.putFile(path, blob, Date.now());
  return Result.ok();
}

export async function readFileFromTree(
  tree: ReadableTree,
  blobStore: WorkspaceBlobStore,
  path: string,
): Promise<WorkspaceReadResult> {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (Result.isError(parsed)) {
    return Result.err(parsed.error);
  }

  const entry = tree.getEntry(path);
  if (!entry) {
    return Result.err(new PathNotFoundError({ path }));
  }
  if (entry.type === "directory") {
    return Result.err(new IsDirectoryError({ path }));
  }

  return blobStore.get(path, entry.blob_key);
}

export function listTree(tree: ReadableTree, path: string): WorkspaceListResult {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (Result.isError(parsed)) {
    return Result.err(parsed.error);
  }

  const entry = tree.getEntry(path);
  if (!entry) {
    return Result.err(new PathNotFoundError({ path }));
  }
  if (entry.type === "file") {
    return Result.err(new NotDirectoryError({ path }));
  }

  return Result.ok(tree.listChildren(path));
}

export function deleteFromTree(tree: MutableTree, path: string): WorkspaceDeleteResult {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return Result.err(parsed.error);
  }

  const entry = tree.getEntry(path);
  if (!entry) {
    return Result.err(new PathNotFoundError({ path }));
  }
  if (entry.type === "directory" && tree.hasChildren(path)) {
    return Result.err(new DirectoryNotEmptyError({ path }));
  }

  tree.deleteEntry(path);
  return Result.ok();
}

export function statTree(tree: ReadableTree, path: string): WorkspaceStatResult {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (Result.isError(parsed)) {
    return Result.err(parsed.error);
  }

  const entry = tree.getEntry(path);
  if (!entry) {
    return Result.err(new PathNotFoundError({ path }));
  }

  return Result.ok(entryToStat(entry));
}

function requireParentDirectory(tree: ReadableTree, path: string): Result<void, PathNotFoundError | NotDirectoryError> {
  const parent = parentPath(path);
  const entry = tree.getEntry(parent);
  if (!entry) {
    return Result.err(new PathNotFoundError({ path: parent }));
  }
  if (entry.type !== "directory") {
    return Result.err(new NotDirectoryError({ path: parent }));
  }

  return Result.ok();
}

function entryToStat(entry: EntryRow): WorkspaceStat {
  return {
    path: entry.path,
    type: entry.type,
    size: entry.size,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}
