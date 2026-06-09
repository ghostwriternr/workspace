import { Result, type Result as BetterResult } from "better-result";
import type {
  ErrorDtoFor,
  WorkspaceApplyError as WorkspaceApplyDomainError,
  WorkspaceCopyCreateError as WorkspaceCopyCreateDomainError,
  WorkspaceCopyLookupError as WorkspaceCopyLookupDomainError,
  WorkspaceDiscardError as WorkspaceDiscardDomainError,
} from "../model/errors";
import {
  WorkspaceCopyNotFoundError,
  WorkspaceCopyStaleError,
  WorkspaceNotFoundError,
} from "../model/errors";
import type { WorkspaceRevision } from "../model/entries";
import { toWorkspaceErrorDto } from "../projections/dto";
import type {
  WorkspaceAuthority,
  WorkspaceAuthorityCopy,
  WorkspaceAuthorityFiles,
} from "../authority";
import type { WorkspaceCopyRecord, WorkspaceObjectClient } from "../workspace-object";
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

type ArtifactsCopyCreateError = ErrorDtoFor<WorkspaceCopyCreateDomainError>;
type ArtifactsCopyLookupError = ErrorDtoFor<WorkspaceCopyLookupDomainError>;
type ArtifactsApplyError = ErrorDtoFor<WorkspaceApplyDomainError>;
type ArtifactsDiscardError = ErrorDtoFor<WorkspaceDiscardDomainError>;

type ArtifactsWorkspaceAuthorityContract = WorkspaceAuthority<
  ArtifactsCurrentFileError,
  ArtifactsCopyCreateError,
  ArtifactsCopyLookupError,
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
    BetterResult<ArtifactsWorkspaceAuthorityCopy, ArtifactsCopyCreateError>
  > {
    try {
      const repo = await this.artifacts.get(this.repositoryName);
      const repoAccess = artifactsRepositoryAccessFrom(repo);
      const current = await this.workspaceObject.currentRepository();
      const remote = current?.remote ?? repoAccess?.remote;
      if (!remote) {
        return Result.err(workspaceNotFoundError(this.repositoryName));
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
        ...(baseRevisionId ? { baseRevisionId } : {}),
      });
      return Result.ok(new ArtifactsWorkspaceCopy(this, copyId, label, createdAt));
    } catch (error) {
      return workspaceNotFoundFromArtifacts(this.repositoryName, error);
    }
  }

  async getCopy(
    id: string,
  ): Promise<
    BetterResult<ArtifactsWorkspaceAuthorityCopy, ArtifactsCopyLookupError>
  > {
    const copy = await this.loadCopy(id);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    return Result.ok(new ArtifactsWorkspaceCopy(
      this,
      id,
      copy.value.label,
      copy.value.createdAt,
    ));
  }

  async applyCopy(
    id: string,
  ): Promise<BetterResult<WorkspaceRevision, ArtifactsApplyError>> {
    const copy = await this.loadCopy(id);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    try {
      const currentRevisionId = await this.driver.currentRevision(
        this.repositoryName,
      );
      if (copy.value.baseRevisionId !== currentRevisionId) {
        return staleCopyError(id, copy.value.baseRevisionId, currentRevisionId);
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
          copy.value.baseRevisionId,
          await this.driver.currentRevision(this.repositoryName),
        );
      }
      return applyFailureFromArtifacts(this.repositoryName, id, error);
    }
  }

  async discardCopy(
    id: string,
  ): Promise<BetterResult<void, ArtifactsDiscardError>> {
    const copy = await this.loadCopy(id);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    try {
      await this.driver.discardWorkingCopy(this.repositoryName, id);
    } catch (error) {
      if (!isMissingWorkingCopyRef(error)) {
        return copyNotFoundFromDiscard(id, error);
      }
    }
    await this.workspaceObject.deleteCopy(id);
    return Result.ok(undefined);
  }

  async loadCopy(id: string): Promise<BetterResult<WorkspaceCopyRecord, ArtifactsCopyLookupError>> {
    try {
      const copy = await this.workspaceObject.copy(id);
      if (!copy) {
        return Result.err(copyNotFoundError(id));
      }
      return Result.ok(copy);
    } catch (error) {
      return copyNotFoundFromLookup(id, error);
    }
  }

  async copyFileTargetExists(
    id: string,
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    const copy = await this.loadCopy(id);
    if (Result.isError(copy)) {
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

function workspaceNotFoundError(workspaceName: string): ArtifactsCopyCreateError {
  return toWorkspaceErrorDto(new WorkspaceNotFoundError({ workspaceName })).error;
}

function copyNotFoundError(id: string): ArtifactsCopyLookupError {
  return toWorkspaceErrorDto(new WorkspaceCopyNotFoundError({ copyId: id }))
    .error;
}

function workspaceNotFoundFromArtifacts<T>(
  name: string,
  error: unknown,
): BetterResult<T, ArtifactsCopyCreateError> {
  if (isArtifactsNotFound(error)) {
    return Result.err(workspaceNotFoundError(name));
  }
  throw error;
}

function copyNotFoundFromLookup<T>(
  id: string,
  error: unknown,
): BetterResult<T, ArtifactsCopyLookupError> {
  if (isArtifactsNotFound(error) || isMissingWorkingCopyRef(error)) {
    return Result.err(copyNotFoundError(id));
  }
  throw error;
}

function applyFailureFromArtifacts<T>(
  workspaceName: string,
  copyId: string,
  error: unknown,
): BetterResult<T, ArtifactsApplyError> {
  if (isArtifactsNotFound(error)) {
    return Result.err(workspaceNotFoundError(workspaceName));
  }
  if (isMissingWorkingCopyRef(error)) {
    return Result.err(copyNotFoundError(copyId));
  }
  throw error;
}

function copyNotFoundFromDiscard<T>(
  id: string,
  error: unknown,
): BetterResult<T, ArtifactsDiscardError> {
  if (isArtifactsNotFound(error) || isMissingWorkingCopyRef(error)) {
    return Result.err(copyNotFoundError(id));
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
  })).error);
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
