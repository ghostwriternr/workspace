import { Result, type Result as BetterResult } from "better-result";
import {
  DirectoryNotEmptyError,
  IsDirectoryError,
  NotDirectoryError,
  PathAlreadyExistsError,
  PathNotFoundError,
} from "../model/errors";
import type { WorkspaceStat } from "../model/entries";
import {
  parseWorkspacePath,
  parentPath,
} from "../model/path";
import { toWorkspaceErrorDto } from "../projections/dto";
import type { ArtifactsFileTarget } from "./file-target";
import { isArtifactsNotFound } from "./errors";

export async function readFileFromTarget(
  target: ArtifactsFileTarget,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(target, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  if (stat.type === "directory") {
    return toWorkspaceErrorDto(new IsDirectoryError({ path }));
  }

  const contents = await target.readFile(path);
  if (!contents) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  return { status: "ok", value: contents } as const;
}

export async function listTarget(target: ArtifactsFileTarget, path: string) {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(target, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  if (stat.type !== "directory") {
    return toWorkspaceErrorDto(new NotDirectoryError({ path }));
  }

  return { status: "ok", value: await target.list(path) } as const;
}

export async function statTarget(target: ArtifactsFileTarget, path: string) {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(target, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  return { status: "ok", value: stat } as const;
}

export async function mkdirInFileTarget(
  target: ArtifactsFileTarget,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const existing = await statOrMissing(target, path);
  if (existing) {
    return toWorkspaceErrorDto(new PathAlreadyExistsError({ path }));
  }

  const parent = await statOrMissing(target, parentPath(path));
  if (!parent) {
    return toWorkspaceErrorDto(
      new PathNotFoundError({ path: parentPath(path) }),
    );
  }
  if (parent.type !== "directory") {
    return toWorkspaceErrorDto(
      new NotDirectoryError({ path: parentPath(path) }),
    );
  }

  return { status: "ok" } as const;
}

export async function writeFileInTarget(
  target: ArtifactsFileTarget,
  path: string,
  contents: Uint8Array,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const existing = await statOrMissing(target, path);
  if (existing?.type === "directory") {
    return toWorkspaceErrorDto(new IsDirectoryError({ path }));
  }

  const parent = await statOrMissing(target, parentPath(path));
  if (parent && parent.type !== "directory") {
    return toWorkspaceErrorDto(
      new NotDirectoryError({ path: parentPath(path) }),
    );
  }

  try {
    await target.writeFile(path, contents);
  } catch (error) {
    if (isArtifactsNotFound(error)) {
      return toWorkspaceErrorDto(new PathNotFoundError({ path }));
    }
    throw error;
  }
  return { status: "ok" } as const;
}

export async function validateWriteTreeFileInTarget(
  target: ArtifactsFileTarget,
  path: string,
  ancestors: string[],
  files: ReadonlyMap<string, Uint8Array>,
  directories: ReadonlySet<string>,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  if (directories.has(path)) {
    return toWorkspaceErrorDto(new IsDirectoryError({ path }));
  }

  const existing = await statOrMissing(target, path);
  if (existing?.type === "directory") {
    return toWorkspaceErrorDto(new IsDirectoryError({ path }));
  }

  for (const ancestor of ancestors) {
    if (files.has(ancestor)) {
      return toWorkspaceErrorDto(new NotDirectoryError({ path: ancestor }));
    }

    const parent = await statOrMissing(target, ancestor);
    if (parent?.type === "file") {
      return toWorkspaceErrorDto(new NotDirectoryError({ path: ancestor }));
    }
  }

  return { status: "ok" } as const;
}

export async function deleteFromTarget(
  target: ArtifactsFileTarget,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(target, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  if (stat.type === "directory") {
    const entries = await target.list(path);
    if (entries.length > 0) {
      return toWorkspaceErrorDto(new DirectoryNotEmptyError({ path }));
    }
    return { status: "ok" } as const;
  }

  try {
    await target.deleteFile(path);
  } catch (error) {
    if (isArtifactsNotFound(error)) {
      return toWorkspaceErrorDto(new PathNotFoundError({ path }));
    }
    throw error;
  }
  return { status: "ok" } as const;
}

type DtoResult<T, E> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: E };

export function dtoToResult<T, E>(result: DtoResult<T, E>): BetterResult<T, E> {
  if (result.status === "error") {
    return Result.err(result.error);
  }

  return Result.ok(result.value as T);
}

async function statOrMissing(
  target: ArtifactsFileTarget,
  path: string,
): Promise<WorkspaceStat | null> {
  try {
    return await target.stat(path);
  } catch (error) {
    if (isArtifactsNotFound(error)) {
      return null;
    }
    throw error;
  }
}
