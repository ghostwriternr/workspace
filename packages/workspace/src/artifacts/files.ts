import { Result, type Result as BetterResult } from "better-result";
import {
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
  workspacePathFromSegments,
} from "../model/path";
import type { WorkspaceAuthorityFiles } from "../authority";
import { toWorkspaceErrorDto } from "../projections/dto";
import type { ArtifactsWorkspaceDriver } from "./driver";
import {
  workingCopyFileTarget,
  type ArtifactsFileTarget,
} from "./file-target";
import { isMissingWorkingCopyRef } from "./errors";
import {
  deleteFromTarget,
  dtoToResult,
  listTarget,
  mkdirInFileTarget,
  readFileFromTarget,
  statTarget,
  validateWriteTreeFileInTarget,
  writeFileInTarget,
} from "./file-operations";

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

function ancestorPaths(segments: string[]): string[] {
  const ancestors: string[] = [];
  for (let length = 1; length < segments.length; length += 1) {
    ancestors.push(workspacePathFromSegments(segments.slice(0, length)));
  }
  return ancestors;
}

function widenFileResult<T>(
  result: BetterResult<T, ArtifactsCurrentFileError>,
): BetterResult<T, ArtifactsCopyFileError> {
  if (Result.isError(result)) {
    return Result.err(result.error);
  }

  return Result.ok(result.value);
}

export function copyNotFoundFileError(copyId: string): ArtifactsCopyFileError {
  return toWorkspaceErrorDto(new WorkspaceCopyNotFoundError({ copyId })).error;
}
