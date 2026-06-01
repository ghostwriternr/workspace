import { Result } from "better-result";
import {
  IsDirectoryError,
  NotDirectoryError,
  type WorkspaceWriteTreeError,
} from "./errors";
import { parseRelativeWorkspacePath, parseWorkspacePath, workspacePathFromSegments } from "./path";
import type { BlobRef, MutableTree, ReadableTree } from "../storage/tree";

export type WorkspaceTreeEntry = {
  path: string;
  contents: Uint8Array;
};

export type WorkspaceWriteTreePlan = {
  directories: string[];
  files: WorkspaceWriteTreePlanFile[];
};

export type WorkspaceWriteTreePlanFile = {
  entryIndex: number;
  targetPath: string;
};

export function buildWriteTreePlan(
  root: string,
  entries: readonly WorkspaceTreeEntry[],
): Result<WorkspaceWriteTreePlan, WorkspaceWriteTreeError> {
  const rootSegments = parseWorkspacePath(root, { allowRoot: true });
  if (Result.isError(rootSegments)) {
    return Result.err(rootSegments.error);
  }

  const directoryPaths = new Set<string>();
  const files: WorkspaceWriteTreePlanFile[] = [];
  addDirectoryAncestors(rootSegments.value, directoryPaths);

  for (const [entryIndex, entry] of entries.entries()) {
    const relativeSegments = parseRelativeWorkspacePath(entry.path);
    if (Result.isError(relativeSegments)) {
      return Result.err(relativeSegments.error);
    }

    const targetSegments = [...rootSegments.value, ...relativeSegments.value];
    const targetPath = workspacePathFromSegments(targetSegments);
    files.push({ entryIndex, targetPath });
    addDirectoryAncestors(targetSegments.slice(0, -1), directoryPaths);
  }

  for (const file of files) {
    if (directoryPaths.has(file.targetPath)) {
      return Result.err(new NotDirectoryError({ path: file.targetPath }));
    }
  }

  return Result.ok({
    directories: [...directoryPaths].sort(comparePathDepth),
    files,
  });
}

export function validateWriteTreePlan(
  tree: ReadableTree,
  plan: WorkspaceWriteTreePlan,
): Result<void, WorkspaceWriteTreeError> {
  for (const path of plan.directories) {
    const entry = tree.getEntry(path);
    if (entry?.type === "file") {
      return Result.err(new NotDirectoryError({ path }));
    }
  }

  for (const file of plan.files) {
    const entry = tree.getEntry(file.targetPath);
    if (entry?.type === "directory") {
      return Result.err(new IsDirectoryError({ path: file.targetPath }));
    }
  }

  return Result.ok();
}

export function writeTreePlanToTree(
  tree: MutableTree,
  plan: WorkspaceWriteTreePlan,
  blobs: readonly BlobRef[],
  now = Date.now(),
): Result<void, WorkspaceWriteTreeError> {
  const validation = validateWriteTreePlan(tree, plan);
  if (Result.isError(validation)) {
    return Result.err(validation.error);
  }

  for (const path of plan.directories) {
    if (!tree.getEntry(path)) {
      tree.putDirectory(path, now);
    }
  }

  for (const file of plan.files) {
    tree.putFile(file.targetPath, blobs[file.entryIndex], now);
  }

  return Result.ok();
}

function addDirectoryAncestors(segments: string[], paths: Set<string>): void {
  for (let index = 1; index <= segments.length; index += 1) {
    paths.add(workspacePathFromSegments(segments.slice(0, index)));
  }
}

function comparePathDepth(left: string, right: string): number {
  return pathDepth(left) - pathDepth(right) || left.localeCompare(right);
}

function pathDepth(path: string): number {
  return path === "/" ? 0 : path.split("/").length - 1;
}
