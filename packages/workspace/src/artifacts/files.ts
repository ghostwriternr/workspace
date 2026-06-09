import { Result, type Result as BetterResult } from "better-result";
import {
  DirectoryNotEmptyError,
  InvalidPathError,
  IsDirectoryError,
  NotDirectoryError,
  PathAlreadyExistsError,
  PathNotFoundError,
  WorkspaceCopyNotFoundError,
  type ErrorDtoFor,
  type WorkspaceCopyFileError as WorkspaceCopyFileDomainError,
  type WorkspaceDeleteError,
  type WorkspaceListError,
  type WorkspaceMkdirError,
  type WorkspaceReadError,
  type WorkspaceStatError,
  type WorkspaceWriteError,
} from "../model/errors";
import type { WorkspaceEntry, WorkspaceStat } from "../model/entries";
import type { WorkspaceTreeEntry } from "../model/write-tree";
import {
  parseRelativeWorkspacePath,
  parseWorkspacePath,
  parentPath,
  workspacePathFromSegments,
} from "../model/path";
import type { WorkspaceAuthorityFiles } from "../authority";
import { toWorkspaceErrorDto } from "../projections/dto";
import type { ArtifactsWorkspaceDriver } from "./driver";
import {
  workingCopyFileTarget,
  type ArtifactsFileTarget,
} from "./file-target";
import { isArtifactsNotFound, isMissingWorkingCopyRef } from "./errors";

export type ArtifactsCurrentFileError = ErrorDtoFor<
  | WorkspaceMkdirError
  | WorkspaceWriteError
  | WorkspaceReadError
  | WorkspaceListError
  | WorkspaceStatError
  | WorkspaceDeleteError
>;

export type ArtifactsCopyFileError = ErrorDtoFor<WorkspaceCopyFileDomainError>;

export function createArtifactsCurrentFiles(
  target: ArtifactsFileTarget,
): WorkspaceAuthorityFiles<ArtifactsCurrentFileError> {
  return new ArtifactsFiles(target);
}

export function createArtifactsCopyFiles(options: {
  driver: ArtifactsWorkspaceDriver;
  repository: string;
  copyId: string;
  ensureCopyExists(): Promise<BetterResult<void, ArtifactsCopyFileError>>;
}): WorkspaceAuthorityFiles<ArtifactsCopyFileError> {
  return new ArtifactsCopyFiles(
    options.driver,
    options.repository,
    options.copyId,
    options.ensureCopyExists,
  );
}

class ArtifactsFiles implements WorkspaceAuthorityFiles<ArtifactsCurrentFileError> {
  constructor(private readonly target: ArtifactsFileTarget) {}

  async mkdir(
    path: string,
  ): Promise<BetterResult<void, ArtifactsCurrentFileError>> {
    return dtoToResult<void, ArtifactsCurrentFileError>(
      await mkdirInFileTarget(this.target, path),
    );
  }

  async write(
    path: string,
    contents: Uint8Array,
  ): Promise<BetterResult<void, ArtifactsCurrentFileError>> {
    return dtoToResult<void, ArtifactsCurrentFileError>(
      await writeFileInTarget(this.target, path, contents),
    );
  }

  async read(
    path: string,
  ): Promise<BetterResult<Uint8Array, ArtifactsCurrentFileError>> {
    return dtoToResult<Uint8Array, ArtifactsCurrentFileError>(
      await readFileFromTarget(this.target, path),
    );
  }

  async list(
    path: string,
  ): Promise<BetterResult<WorkspaceEntry[], ArtifactsCurrentFileError>> {
    return dtoToResult<WorkspaceEntry[], ArtifactsCurrentFileError>(
      await listTarget(this.target, path),
    );
  }

  async stat(
    path: string,
  ): Promise<BetterResult<WorkspaceStat, ArtifactsCurrentFileError>> {
    return dtoToResult<WorkspaceStat, ArtifactsCurrentFileError>(
      await statTarget(this.target, path),
    );
  }

  async delete(
    path: string,
  ): Promise<BetterResult<void, ArtifactsCurrentFileError>> {
    return dtoToResult<void, ArtifactsCurrentFileError>(
      await deleteFromTarget(this.target, path),
    );
  }
}

class ArtifactsCopyFiles implements WorkspaceAuthorityFiles<ArtifactsCopyFileError> {
  constructor(
    private readonly driver: ArtifactsWorkspaceDriver,
    private readonly repository: string,
    private readonly copyId: string,
    private readonly ensureCopyExists: () => Promise<
      BetterResult<void, ArtifactsCopyFileError>
    >,
  ) {}

  async mkdir(path: string): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    return this.withExistingCopy(async () =>
      widenFileResult(await this.files().mkdir(path)),
    );
  }

  async write(
    path: string,
    contents: Uint8Array,
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    return this.withExistingCopy(async () =>
      widenFileResult(await this.files().write(path, contents)),
    );
  }

  async writeTreeBatch(
    root: string,
    entries: WorkspaceTreeEntry[],
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);

    return this.withVisibleTarget(async () => {
      const rootSegments = parseWorkspacePath(root, { allowRoot: true });
      if (Result.isError(rootSegments)) {
        return Result.err(toWorkspaceErrorDto(rootSegments.error).error);
      }

      const target = this.target();
      const files = new Map<string, Uint8Array>();
      const directories = new Set<string>();
      for (const entry of entries) {
        const relative = parseRelativeWorkspacePath(entry.path);
        if (Result.isError(relative)) {
          return Result.err(toWorkspaceErrorDto(relative.error).error);
        }

        const segments = [...rootSegments.value, ...relative.value];
        const path = workspacePathFromSegments(segments);
        const ancestors = ancestorPaths(segments);
        const validated = await validateWriteTreeFileInTarget(
          target,
          path,
          ancestors,
          files,
          directories,
        );
        if (validated.status === "error") {
          return Result.err(validated.error);
        }

        files.set(path, entry.contents);
        for (const ancestor of ancestors) {
          directories.add(ancestor);
        }
      }

      await this.driver.writeWorkingCopyFiles(
        this.repository,
        this.copyId,
        [...files].map(([path, contents]) => ({ path, contents })),
      );
      return Result.ok(undefined);
    });
  }

  async read(
    path: string,
  ): Promise<BetterResult<Uint8Array, ArtifactsCopyFileError>> {
    return this.withExistingCopy(async () =>
      widenFileResult(await this.files().read(path)),
    );
  }

  async list(
    path: string,
  ): Promise<BetterResult<WorkspaceEntry[], ArtifactsCopyFileError>> {
    return this.withExistingCopy(async () =>
      widenFileResult(await this.files().list(path)),
    );
  }

  async stat(
    path: string,
  ): Promise<BetterResult<WorkspaceStat, ArtifactsCopyFileError>> {
    return this.withExistingCopy(async () =>
      widenFileResult(await this.files().stat(path)),
    );
  }

  async delete(path: string): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    return this.withExistingCopy(async () =>
      widenFileResult(await this.files().delete(path)),
    );
  }

  private async withExistingCopy<T>(
    operation: () => Promise<BetterResult<T, ArtifactsCopyFileError>>,
  ): Promise<BetterResult<T, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);
    return this.withVisibleTarget(operation);
  }

  private async withVisibleTarget<T>(
    operation: () => Promise<BetterResult<T, ArtifactsCopyFileError>>,
  ): Promise<BetterResult<T, ArtifactsCopyFileError>> {
    try {
      return await operation();
    } catch (error) {
      if (isMissingWorkingCopyRef(error)) {
        return Result.err(copyNotFoundFileError(this.copyId));
      }
      throw error;
    }
  }

  private files(): ArtifactsFiles {
    return new ArtifactsFiles(this.target());
  }

  private target(): ArtifactsFileTarget {
    return workingCopyFileTarget(this.driver, this.repository, this.copyId);
  }
}

async function readFileFromTarget(target: ArtifactsFileTarget, path: string) {
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

async function listTarget(target: ArtifactsFileTarget, path: string) {
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

async function statTarget(target: ArtifactsFileTarget, path: string) {
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

async function mkdirInFileTarget(target: ArtifactsFileTarget, path: string) {
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

async function writeFileInTarget(
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

async function validateWriteTreeFileInTarget(
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

function ancestorPaths(segments: string[]): string[] {
  const ancestors: string[] = [];
  for (let length = 1; length < segments.length; length += 1) {
    ancestors.push(workspacePathFromSegments(segments.slice(0, length)));
  }
  return ancestors;
}

async function deleteFromTarget(target: ArtifactsFileTarget, path: string) {
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

function widenFileResult<T>(
  result: BetterResult<T, ArtifactsCurrentFileError>,
): BetterResult<T, ArtifactsCopyFileError> {
  if (Result.isError(result)) {
    return Result.err(result.error);
  }

  return Result.ok(result.value);
}

type DtoResult<T, E> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: E };

function dtoToResult<T, E>(result: DtoResult<T, E>): BetterResult<T, E> {
  if (result.status === "error") {
    return Result.err(result.error);
  }

  return Result.ok(result.value as T);
}

export function copyNotFoundFileError(copyId: string): ArtifactsCopyFileError {
  return toWorkspaceErrorDto(new WorkspaceCopyNotFoundError({ copyId })).error;
}
