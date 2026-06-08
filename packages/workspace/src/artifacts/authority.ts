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
  type WorkspaceApplyError as WorkspaceApplyDomainError,
  type WorkspaceCopyError as WorkspaceCopyDomainError,
  type WorkspaceCopyFileError as WorkspaceCopyFileDomainError,
  type WorkspaceDeleteError,
  type WorkspaceDiscardError as WorkspaceDiscardDomainError,
  type WorkspaceListError,
  type WorkspaceMkdirError,
  type WorkspaceReadError,
  type WorkspaceStatError,
  type WorkspaceWriteError,
} from "../model/errors";
import {
  parseRelativeWorkspacePath,
  parseWorkspacePath,
  parentPath,
  workspacePathFromSegments,
} from "../model/path";
import type {
  WorkspaceEntry,
  WorkspaceRevision,
  WorkspaceStat,
} from "../model/entries";
import { toWorkspaceErrorDto } from "../projections/dto";
import type { WorkspaceTreeEntry } from "../model/write-tree";
import type {
  WorkspaceAuthority,
  WorkspaceAuthorityCopy,
  WorkspaceAuthorityFiles,
} from "../authority";
import type { WorkspaceObjectClient } from "../workspace-object";
import type { ArtifactsBindingClient } from "./binding";
export type { ArtifactsBindingClient, ArtifactsRepoClient } from "./binding";

export type ArtifactsWorkspaceFileWrite = {
  path: string;
  contents: Uint8Array;
};

export type ArtifactsWorkspaceDriver = {
  repositoryExists(repository: string): Promise<boolean>;
  readFile(repository: string, path: string): Promise<Uint8Array | null>;
  list(repository: string, path: string): Promise<WorkspaceEntry[]>;
  stat(repository: string, path: string): Promise<WorkspaceStat | null>;
  writeFile(
    repository: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void>;
  writeFiles(
    repository: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void>;
  deleteFile(repository: string, path: string): Promise<void>;
  applyWorkingCopy(
    baseRepository: string,
    workingCopyRepository: string,
  ): Promise<WorkspaceRevision>;
};

type ArtifactsWorkspaceDriverFactory = (
  artifacts: ArtifactsBindingClient,
  workspaceObject: WorkspaceObjectClient,
) => ArtifactsWorkspaceDriver;

type ArtifactsCurrentFileError = ErrorDtoFor<
  | WorkspaceMkdirError
  | WorkspaceWriteError
  | WorkspaceReadError
  | WorkspaceListError
  | WorkspaceStatError
  | WorkspaceDeleteError
>;
type ArtifactsCopyError = ErrorDtoFor<WorkspaceCopyDomainError>;
type ArtifactsCopyFileError = ErrorDtoFor<WorkspaceCopyFileDomainError>;
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
    private readonly repositoryName: string,
    private readonly driver: ArtifactsWorkspaceDriver,
  ) {
    this.files = new ArtifactsRepositoryFiles(driver, repositoryName);
  }

  async createCopy(
    _name?: string,
  ): Promise<
    BetterResult<ArtifactsWorkspaceAuthorityCopy, ArtifactsCopyError>
  > {
    try {
      const repo = await this.artifacts.get(this.repositoryName);
      const copyName = `${this.repositoryName}-copy-${crypto.randomUUID()}`;
      const fork = await repo.fork(copyName, {
        description: `Workspace working copy for ${this.repositoryName}`,
        defaultBranchOnly: true,
      });
      const forkAccess = artifactsRepositoryAccessFrom(fork);
      const baseAccess = await this.workspaceObject.repositoryAccess(this.repositoryName);
      if (forkAccess) {
        await this.workspaceObject.recordCopy({
          copyId: fork.name,
          baseRepository: this.repositoryName,
          remote: forkAccess.remote,
          defaultBranch: baseAccess?.defaultBranch ?? forkAccess.defaultBranch ?? "main",
        });
      }
      return Result.ok(new ArtifactsWorkspaceCopy(this, fork.name, Date.now()));
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

    return Result.ok(new ArtifactsWorkspaceCopy(this, id, Date.now()));
  }

  async copyExists(
    id: string,
  ): Promise<BetterResult<void, ArtifactsCopyError>> {
    try {
      if (!(await this.driver.repositoryExists(id))) {
        return Result.err(copyNotFoundError(id));
      }
      return Result.ok(undefined);
    } catch (error) {
      return copyNotFoundFromArtifacts(id, error);
    }
  }

  async applyCopy(
    id: string,
  ): Promise<BetterResult<WorkspaceRevision, ArtifactsApplyError>> {
    const exists = await this.copyExists(id);
    if (Result.isError(exists)) {
      return Result.err(exists.error);
    }

    try {
      const revision = await this.driver.applyWorkingCopy(
        this.repositoryName,
        id,
      );
      await this.artifacts.delete(id);
      await this.workspaceObject.deleteCopy(id);
      return Result.ok(revision);
    } catch (error) {
      return copyNotFoundFromArtifacts(id, error);
    }
  }

  async discardCopy(
    id: string,
  ): Promise<BetterResult<void, ArtifactsDiscardError>> {
    try {
      const deleted = await this.artifacts.delete(id);
      if (!deleted) {
        return Result.err(copyNotFoundError(id));
      }
      await this.workspaceObject.deleteCopy(id);
      return Result.ok(undefined);
    } catch (error) {
      return copyNotFoundFromArtifacts(id, error);
    }
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
    readonly createdAt: number,
  ) {
    this.files = new ArtifactsCopyFiles(authority.workspaceDriver(), id, () =>
      authority.copyExists(id),
    );
  }

  apply(): Promise<BetterResult<WorkspaceRevision, ArtifactsApplyError>> {
    return this.authority.applyCopy(this.id);
  }

  discard(): Promise<BetterResult<void, ArtifactsDiscardError>> {
    return this.authority.discardCopy(this.id);
  }
}

class ArtifactsRepositoryFiles implements WorkspaceAuthorityFiles<ArtifactsCurrentFileError> {
  constructor(
    private readonly driver: ArtifactsWorkspaceDriver,
    private readonly repository: string,
  ) {}

  async mkdir(
    path: string,
  ): Promise<BetterResult<void, ArtifactsCurrentFileError>> {
    return dtoToResult<void, ArtifactsCurrentFileError>(
      await mkdirInRepository(this.driver, this.repository, path),
    );
  }

  async write(
    path: string,
    contents: Uint8Array,
  ): Promise<BetterResult<void, ArtifactsCurrentFileError>> {
    return dtoToResult<void, ArtifactsCurrentFileError>(
      await writeFileInRepository(this.driver, this.repository, path, contents),
    );
  }

  async read(
    path: string,
  ): Promise<BetterResult<Uint8Array, ArtifactsCurrentFileError>> {
    return dtoToResult<Uint8Array, ArtifactsCurrentFileError>(
      await readFileFromRepository(this.driver, this.repository, path),
    );
  }

  async list(
    path: string,
  ): Promise<BetterResult<WorkspaceEntry[], ArtifactsCurrentFileError>> {
    return dtoToResult<WorkspaceEntry[], ArtifactsCurrentFileError>(
      await listRepository(this.driver, this.repository, path),
    );
  }

  async stat(
    path: string,
  ): Promise<BetterResult<WorkspaceStat, ArtifactsCurrentFileError>> {
    return dtoToResult<WorkspaceStat, ArtifactsCurrentFileError>(
      await statRepository(this.driver, this.repository, path),
    );
  }

  async delete(
    path: string,
  ): Promise<BetterResult<void, ArtifactsCurrentFileError>> {
    return dtoToResult<void, ArtifactsCurrentFileError>(
      await deleteFromRepository(this.driver, this.repository, path),
    );
  }
}

class ArtifactsCopyFiles implements WorkspaceAuthorityFiles<ArtifactsCopyFileError> {
  constructor(
    private readonly driver: ArtifactsWorkspaceDriver,
    private readonly copyId: string,
    private readonly ensureCopyExists: () => Promise<
      BetterResult<void, ArtifactsCopyError>
    >,
  ) {}

  async mkdir(
    path: string,
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);
    return widenFileResult(await this.repositoryFiles().mkdir(path));
  }

  async write(
    path: string,
    contents: Uint8Array,
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);
    return widenFileResult(await this.repositoryFiles().write(path, contents));
  }

  async writeTreeBatch(
    root: string,
    entries: WorkspaceTreeEntry[],
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);

    const rootSegments = parseWorkspacePath(root, { allowRoot: true });
    if (Result.isError(rootSegments)) {
      return Result.err(toWorkspaceErrorDto(rootSegments.error).error);
    }

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
      const validated = await validateWriteTreeFileInRepository(
        this.driver,
        this.copyId,
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

    await this.driver.writeFiles(
      this.copyId,
      [...files].map(([path, contents]) => ({ path, contents })),
    );
    return Result.ok(undefined);
  }

  async read(
    path: string,
  ): Promise<BetterResult<Uint8Array, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);
    return widenFileResult(await this.repositoryFiles().read(path));
  }

  async list(
    path: string,
  ): Promise<BetterResult<WorkspaceEntry[], ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);
    return widenFileResult(await this.repositoryFiles().list(path));
  }

  async stat(
    path: string,
  ): Promise<BetterResult<WorkspaceStat, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);
    return widenFileResult(await this.repositoryFiles().stat(path));
  }

  async delete(
    path: string,
  ): Promise<BetterResult<void, ArtifactsCopyFileError>> {
    const exists = await this.ensureCopyExists();
    if (Result.isError(exists)) return Result.err(exists.error);
    return widenFileResult(await this.repositoryFiles().delete(path));
  }

  private repositoryFiles(): ArtifactsRepositoryFiles {
    return new ArtifactsRepositoryFiles(this.driver, this.copyId);
  }
}

async function readFileFromRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(driver, repository, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  if (stat.type === "directory") {
    return toWorkspaceErrorDto(new IsDirectoryError({ path }));
  }

  const contents = await driver.readFile(repository, path);
  if (!contents) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  return { status: "ok", value: contents } as const;
}

async function listRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(driver, repository, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  if (stat.type !== "directory") {
    return toWorkspaceErrorDto(new NotDirectoryError({ path }));
  }

  return { status: "ok", value: await driver.list(repository, path) } as const;
}

async function statRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(driver, repository, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  return { status: "ok", value: stat } as const;
}

async function mkdirInRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const existing = await statOrMissing(driver, repository, path);
  if (existing) {
    return toWorkspaceErrorDto(new PathAlreadyExistsError({ path }));
  }

  const parent = await statOrMissing(driver, repository, parentPath(path));
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

async function writeFileInRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
  contents: Uint8Array,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const existing = await statOrMissing(driver, repository, path);
  if (existing?.type === "directory") {
    return toWorkspaceErrorDto(new IsDirectoryError({ path }));
  }

  const parent = await statOrMissing(driver, repository, parentPath(path));
  if (parent && parent.type !== "directory") {
    return toWorkspaceErrorDto(
      new NotDirectoryError({ path: parentPath(path) }),
    );
  }

  await driver.writeFile(repository, path, contents);
  return { status: "ok" } as const;
}

async function validateWriteTreeFileInRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
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

  const existing = await statOrMissing(driver, repository, path);
  if (existing?.type === "directory") {
    return toWorkspaceErrorDto(new IsDirectoryError({ path }));
  }

  for (const ancestor of ancestors) {
    if (files.has(ancestor)) {
      return toWorkspaceErrorDto(new NotDirectoryError({ path: ancestor }));
    }

    const parent = await statOrMissing(driver, repository, ancestor);
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

async function deleteFromRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toWorkspaceErrorDto(parsed.error);
  }

  const stat = await statOrMissing(driver, repository, path);
  if (!stat) {
    return toWorkspaceErrorDto(new PathNotFoundError({ path }));
  }
  if (stat.type === "directory") {
    const entries = await driver.list(repository, path);
    if (entries.length > 0) {
      return toWorkspaceErrorDto(new DirectoryNotEmptyError({ path }));
    }
    return { status: "ok" } as const;
  }

  await driver.deleteFile(repository, path);
  return { status: "ok" } as const;
}

async function statOrMissing(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
): Promise<WorkspaceStat | null> {
  try {
    return await driver.stat(repository, path);
  } catch (error) {
    if (isArtifactsNotFound(error)) {
      return null;
    }
    throw error;
  }
}

function isArtifactsNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { name?: unknown; code?: unknown }).name === "ArtifactsError" &&
    (error as { code?: unknown }).code === "NOT_FOUND"
  );
}

function copyNotFoundError(id: string): ArtifactsCopyError {
  return toWorkspaceErrorDto(new WorkspaceCopyNotFoundError({ copyId: id }))
    .error;
}

function copyNotFoundFromArtifacts<T, E extends ArtifactsCopyError>(
  id: string,
  _error: unknown,
): BetterResult<T, E> {
  return Result.err(copyNotFoundError(id) as E);
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

function createLazyIsomorphicGitArtifactsWorkspaceDriver(
  artifacts: ArtifactsBindingClient,
  workspaceObject: WorkspaceObjectClient,
): ArtifactsWorkspaceDriver {
  return new LazyIsomorphicGitArtifactsWorkspaceDriver(artifacts, workspaceObject);
}

class LazyIsomorphicGitArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  private driver?: Promise<ArtifactsWorkspaceDriver>;

  constructor(
    private readonly artifacts: ArtifactsBindingClient,
    private readonly workspaceObject: WorkspaceObjectClient,
  ) {}

  async repositoryExists(repository: string): Promise<boolean> {
    const driver = await this.load();
    return await driver.repositoryExists(repository);
  }

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    const driver = await this.load();
    return await driver.readFile(repository, path);
  }

  async list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    const driver = await this.load();
    return await driver.list(repository, path);
  }

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    const driver = await this.load();
    return await driver.stat(repository, path);
  }

  async writeFile(
    repository: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void> {
    const driver = await this.load();
    return await driver.writeFile(repository, path, contents);
  }

  async writeFiles(
    repository: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void> {
    const driver = await this.load();
    return await driver.writeFiles(repository, files);
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    const driver = await this.load();
    return await driver.deleteFile(repository, path);
  }

  async applyWorkingCopy(
    baseRepository: string,
    workingCopyRepository: string,
  ): Promise<WorkspaceRevision> {
    const driver = await this.load();
    return await driver.applyWorkingCopy(baseRepository, workingCopyRepository);
  }

  private load(): Promise<ArtifactsWorkspaceDriver> {
    this.driver ??= import("./git-driver").then((module) =>
      module.createIsomorphicGitArtifactsWorkspaceDriver(this.artifacts, this.workspaceObject),
    );
    return this.driver;
  }
}

function artifactsRepositoryAccessFrom(value: unknown): { remote: string; defaultBranch?: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const remote = (value as { remote?: unknown }).remote;
  const defaultBranch = (value as { defaultBranch?: unknown }).defaultBranch;
  if (typeof remote !== "string") return undefined;
  return {
    remote,
    ...(typeof defaultBranch === "string" ? { defaultBranch } : {}),
  };
}
