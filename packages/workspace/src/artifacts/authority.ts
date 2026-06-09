import { Result, type Result as BetterResult } from "better-result";
import type {
  ErrorDtoFor,
  WorkspaceApplyError as WorkspaceApplyDomainError,
  WorkspaceCopyError as WorkspaceCopyDomainError,
  WorkspaceDiscardError as WorkspaceDiscardDomainError,
} from "../model/errors";
import {
  WorkspaceCopyNotFoundError,
  WorkspaceCopyStaleError,
} from "../model/errors";
import type { WorkspaceRevision } from "../model/entries";
import { toWorkspaceErrorDto } from "../projections/dto";
import type {
  WorkspaceAuthority,
  WorkspaceAuthorityCopy,
  WorkspaceAuthorityFiles,
} from "../authority";
import type { WorkspaceObjectClient } from "../workspace-object";
import type { ArtifactsBindingClient } from "./binding";
import {
  createLazyIsomorphicGitArtifactsWorkspaceDriver,
  type ArtifactsWorkspaceDriver,
  type ArtifactsWorkspaceDriverFactory,
} from "./driver";
import {
  createArtifactsCopyFiles,
  createArtifactsCurrentFiles,
  copyNotFoundFileError,
  type ArtifactsCopyFileError,
  type ArtifactsCurrentFileError,
} from "./files";
import { currentFileTarget } from "./file-target";
import { isArtifactsNotFound, isGitPushRejected, isMissingWorkingCopyRef } from "./errors";

export type { ArtifactsBindingClient, ArtifactsRepoClient } from "./binding";
export type { ArtifactsWorkspaceDriver, ArtifactsWorkspaceDriverFactory } from "./driver";
export type { ArtifactsWorkspaceFileWrite } from "./file-target";

type ArtifactsCopyError = ErrorDtoFor<WorkspaceCopyDomainError>;
type ArtifactsApplyError = ErrorDtoFor<WorkspaceApplyDomainError>;
type ArtifactsDiscardError = ErrorDtoFor<WorkspaceDiscardDomainError>;

type ArtifactsWorkspaceAuthorityContract = WorkspaceAuthority<
  ArtifactsCurrentFileError,
  ArtifactsCopyError,
  ArtifactsCopyError,
  ArtifactsCopyFileError,
  ArtifactsApplyError,
  ArtifactsDiscardError
>;

type ArtifactsWorkspaceAuthorityCopy = WorkspaceAuthorityCopy<
  ArtifactsCopyFileError,
  ArtifactsApplyError,
  ArtifactsDiscardError
>;

let driverFactory: ArtifactsWorkspaceDriverFactory =
  createLazyIsomorphicGitArtifactsWorkspaceDriver;

export type ArtifactsWorkspaceAuthorityOptions = {
  artifacts: ArtifactsBindingClient;
  object: WorkspaceObjectClient;
  name: string;
};

export function createArtifactsWorkspaceAuthority(
  options: ArtifactsWorkspaceAuthorityOptions,
): ArtifactsWorkspaceAuthorityContract {
  return new ArtifactsWorkspaceAuthority(
    options.artifacts,
    options.object,
    options.name,
    driverFactory(options.artifacts, options.object),
  );
}

export function setArtifactsWorkspaceDriverFactoryForTests(
  factory: ArtifactsWorkspaceDriverFactory,
): void {
  driverFactory = factory;
}

export function resetArtifactsWorkspaceDriverFactoryForTests(): void {
  driverFactory = createLazyIsomorphicGitArtifactsWorkspaceDriver;
}

class ArtifactsWorkspaceAuthority implements ArtifactsWorkspaceAuthorityContract {
  readonly files: WorkspaceAuthorityFiles<ArtifactsCurrentFileError>;

  constructor(
    private readonly artifacts: ArtifactsBindingClient,
    private readonly workspaceObject: WorkspaceObjectClient,
    readonly repositoryName: string,
    private readonly driver: ArtifactsWorkspaceDriver,
  ) {
    this.files = createArtifactsCurrentFiles(
      currentFileTarget(driver, repositoryName),
    );
  }

  async createCopy(
    label?: string,
  ): Promise<
    BetterResult<ArtifactsWorkspaceAuthorityCopy, ArtifactsCopyError>
  > {
    try {
      const repo = await this.artifacts.get(this.repositoryName);
      const repoAccess = artifactsRepositoryAccessFrom(repo);
      const current = await this.workspaceObject.currentRepository();
      const remote = current?.remote ?? repoAccess?.remote;
      if (!remote) {
        return Result.err(copyNotFoundError(this.repositoryName));
      }

      const copyId = `${this.repositoryName}-copy-${crypto.randomUUID()}`;
      const createdAt = Date.now();
      const baseRevisionId = await this.driver.createWorkingCopy(
        this.repositoryName,
        copyId,
      );
      await this.workspaceObject.recordCopy({
        copyId,
        ...(label ? { label } : {}),
        createdAt,
        baseRepository: this.repositoryName,
        remote,
        defaultBranch: current?.defaultBranch ?? repoAccess?.defaultBranch ?? "main",
        ...(baseRevisionId ? { baseRevisionId } : {}),
      });
      return Result.ok(new ArtifactsWorkspaceCopy(this, copyId, label, createdAt));
    } catch (error) {
      return copyNotFoundFromArtifacts(this.repositoryName, error);
    }
  }

  async getCopy(
    id: string,
  ): Promise<
    BetterResult<ArtifactsWorkspaceAuthorityCopy, ArtifactsCopyError>
  > {
    const exists = await this.copyExists(id);
    if (Result.isError(exists)) {
      return Result.err(exists.error);
    }

    const copy = await this.workspaceObject.copy(id);
    return Result.ok(new ArtifactsWorkspaceCopy(this, id, copy?.label, copy!.createdAt));
  }

  async applyCopy(
    id: string,
  ): Promise<BetterResult<WorkspaceRevision, ArtifactsApplyError>> {
    const exists = await this.copyExists(id);
    if (Result.isError(exists)) {
      return Result.err(exists.error);
    }

    const copy = await this.workspaceObject.copy(id);
    try {
      const currentRevisionId = await this.driver.currentRevision(
        this.repositoryName,
      );
      if (copy?.baseRevisionId !== currentRevisionId) {
        return staleCopyError(id, copy?.baseRevisionId, currentRevisionId);
      }

      const revision = await this.driver.applyWorkingCopy(
        this.repositoryName,
        id,
      );
      try {
        await this.driver.discardWorkingCopy(this.repositoryName, id);
      } catch (error) {
        if (!isMissingWorkingCopyRef(error)) {
          throw error;
        }
      }
      await this.workspaceObject.deleteCopy(id);
      return Result.ok(revision);
    } catch (error) {
      if (isGitPushRejected(error)) {
        return staleCopyError(
          id,
          copy?.baseRevisionId,
          await this.driver.currentRevision(this.repositoryName),
        );
      }
      return copyNotFoundFromArtifacts(id, error);
    }
  }

  async discardCopy(
    id: string,
  ): Promise<BetterResult<void, ArtifactsDiscardError>> {
    const exists = await this.copyExists(id);
    if (Result.isError(exists)) {
      return Result.err(exists.error);
    }

    try {
      await this.driver.discardWorkingCopy(this.repositoryName, id);
    } catch (error) {
      if (!isMissingWorkingCopyRef(error)) {
        return copyNotFoundFromArtifacts(id, error);
      }
    }
    await this.workspaceObject.deleteCopy(id);
    return Result.ok(undefined);
  }

  async copyExists(id: string): Promise<BetterResult<void, ArtifactsCopyError>> {
    try {
      const copy = await this.workspaceObject.copy(id);
      if (copy?.baseRepository !== this.repositoryName) {
        return Result.err(copyNotFoundError(id));
      }
      return Result.ok(undefined);
    } catch (error) {
      return copyNotFoundFromArtifacts(id, error);
    }
  }

  async copyFileTargetExists(
    id: string,
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    const exists = await this.copyExists(id);
    if (Result.isError(exists)) {
      return Result.err(copyNotFoundFileError(id));
    }
    return Result.ok(undefined);
  }

  workspaceDriver(): ArtifactsWorkspaceDriver {
    return this.driver;
  }
}

class ArtifactsWorkspaceCopy implements ArtifactsWorkspaceAuthorityCopy {
  readonly files: WorkspaceAuthorityFiles<ArtifactsCopyFileError>;

  constructor(
    private readonly authority: ArtifactsWorkspaceAuthority,
    readonly id: string,
    readonly label: string | undefined,
    readonly createdAt: number,
  ) {
    this.files = createArtifactsCopyFiles({
      driver: authority.workspaceDriver(),
      repository: authority.repositoryName,
      copyId: id,
      ensureCopyExists: () => authority.copyFileTargetExists(id),
    });
  }

  apply(): Promise<BetterResult<WorkspaceRevision, ArtifactsApplyError>> {
    return this.authority.applyCopy(this.id);
  }

  discard(): Promise<BetterResult<void, ArtifactsDiscardError>> {
    return this.authority.discardCopy(this.id);
  }
}

function copyNotFoundError(id: string): ArtifactsCopyError {
  return toWorkspaceErrorDto(new WorkspaceCopyNotFoundError({ copyId: id }))
    .error;
}

function copyNotFoundFromArtifacts<T, E extends ArtifactsCopyError>(
  id: string,
  error: unknown,
): BetterResult<T, E> {
  if (isArtifactsNotFound(error) || isMissingWorkingCopyRef(error)) {
    return Result.err(copyNotFoundError(id) as E);
  }
  throw error;
}

function staleCopyError(
  copyId: string,
  baseRevisionId: string | undefined,
  currentRevisionId: string | undefined,
): BetterResult<never, ArtifactsApplyError> {
  return Result.err(toWorkspaceErrorDto(new WorkspaceCopyStaleError({
    copyId,
    ...(baseRevisionId ? { baseRevisionId } : {}),
    ...(currentRevisionId ? { currentRevisionId } : {}),
  })).error as ArtifactsApplyError);
}

function artifactsRepositoryAccessFrom(
  value: unknown,
): { remote: string; defaultBranch?: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const remote = (value as { remote?: unknown }).remote;
  const defaultBranch = (value as { defaultBranch?: unknown }).defaultBranch;
  if (typeof remote !== "string") return undefined;
  return {
    remote,
    ...(typeof defaultBranch === "string" ? { defaultBranch } : {}),
  };
}
