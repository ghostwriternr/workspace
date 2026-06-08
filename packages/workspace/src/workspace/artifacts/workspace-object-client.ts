import { Result } from "better-result";
import { getArtifactsRepositoryAccess, registerArtifactsRepositoryAccess } from "./access-registry";
import {
  DirectoryNotEmptyError,
  InvalidPathError,
  IsDirectoryError,
  NotDirectoryError,
  PathAlreadyExistsError,
  PathNotFoundError,
  SessionNotFoundError,
} from "../model/errors";
import { parseRelativeWorkspacePath, parseWorkspacePath, parentPath, workspacePathFromSegments } from "../model/path";
import {
  toRpcError,
  type WorkspaceDeleteRpcResult,
  type WorkspaceEntry,
  type WorkspaceListRpcResult,
  type WorkspaceMkdirRpcResult,
  type WorkspaceReadRpcResult,
  type WorkspaceRevision,
  type WorkspaceSessionCommitRpcResult,
  type WorkspaceSessionDeleteRpcResult,
  type WorkspaceSessionDiscardRpcResult,
  type WorkspaceSessionInfoRpcResult,
  type WorkspaceSessionListRpcResult,
  type WorkspaceSessionMkdirRpcResult,
  type WorkspaceSessionReadRpcResult,
  type WorkspaceSessionStatRpcResult,
  type WorkspaceSessionWriteRpcResult,
  type WorkspaceSessionWriteTreeBatchRpcResult,
  type WorkspaceStat,
  type WorkspaceStatRpcResult,
  type WorkspaceWriteRpcResult,
} from "../model/rpc";
import type { WorkspaceTreeEntry } from "../model/write-tree";
import type { WorkspaceObjectClient } from "../product/workspace";

export type ArtifactsBindingClient = {
  get(name: string): Promise<ArtifactsRepoClient>;
  delete(name: string): Promise<boolean>;
};

export type ArtifactsRepoClient = {
  name: string;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }): Promise<{
    name: string;
    remote?: string;
    defaultBranch?: string;
    token?: string;
  }>;
};

export type ArtifactsWorkspaceDriver = {
  repositoryExists(repository: string): Promise<boolean>;
  readFile(repository: string, path: string): Promise<Uint8Array | null>;
  list(repository: string, path: string): Promise<WorkspaceEntry[]>;
  stat(repository: string, path: string): Promise<WorkspaceStat | null>;
  writeFile(repository: string, path: string, contents: Uint8Array): Promise<void>;
  deleteFile(repository: string, path: string): Promise<void>;
  applyWorkingCopy(baseRepository: string, workingCopyRepository: string): Promise<WorkspaceRevision>;
};

type ArtifactsWorkspaceDriverFactory = (artifacts: ArtifactsBindingClient) => ArtifactsWorkspaceDriver;

let driverFactory: ArtifactsWorkspaceDriverFactory = createLazyIsomorphicGitArtifactsWorkspaceDriver;

export function createArtifactsWorkspaceObjectClient(
  artifacts: ArtifactsBindingClient,
  repositoryName: string,
): WorkspaceObjectClient {
  return new ArtifactsWorkspaceObjectClient(artifacts, repositoryName, driverFactory(artifacts));
}

export function setArtifactsWorkspaceDriverFactoryForTests(factory: ArtifactsWorkspaceDriverFactory): void {
  driverFactory = factory;
}

export function resetArtifactsWorkspaceDriverFactoryForTests(): void {
  driverFactory = createLazyIsomorphicGitArtifactsWorkspaceDriver;
}

class ArtifactsWorkspaceObjectClient implements WorkspaceObjectClient {
  constructor(
    private readonly artifacts: ArtifactsBindingClient,
    private readonly repositoryName: string,
    private readonly driver: ArtifactsWorkspaceDriver,
  ) {}

  async beginSession(): Promise<WorkspaceSessionInfoRpcResult> {
    try {
      const repo = await this.artifacts.get(this.repositoryName);
      const workingCopyName = `${this.repositoryName}-copy-${crypto.randomUUID()}`;
      const fork = await repo.fork(workingCopyName, {
        description: `Workspace working copy for ${this.repositoryName}`,
        defaultBranchOnly: true,
      });
      const baseAccess = getArtifactsRepositoryAccess(this.repositoryName);
      if (fork.remote && fork.token) {
        registerArtifactsRepositoryAccess({
          name: fork.name,
          remote: fork.remote,
          defaultBranch: baseAccess?.defaultBranch ?? fork.defaultBranch ?? "main",
          token: fork.token,
        });
      }
      return { status: "ok", value: { sessionId: fork.name, createdAt: Date.now() } } as const;
    } catch (error) {
      return sessionNotFoundFromArtifacts(this.repositoryName, error);
    }
  }

  async getSession(id: string): Promise<WorkspaceSessionInfoRpcResult> {
    try {
      if (!(await this.driver.repositoryExists(id))) {
        return toRpcError(new SessionNotFoundError({ sessionId: id }));
      }
      return { status: "ok", value: { sessionId: id, createdAt: Date.now() } } as const;
    } catch (error) {
      return sessionNotFoundFromArtifacts(id, error);
    }
  }

  async mkdir(path: string): Promise<WorkspaceMkdirRpcResult> {
    return mkdirInRepository(this.driver, this.repositoryName, path);
  }

  async writeFile(path: string, contents: Uint8Array): Promise<WorkspaceWriteRpcResult> {
    return writeFileInRepository(this.driver, this.repositoryName, path, contents);
  }

  async readFile(path: string): Promise<WorkspaceReadRpcResult> {
    return readFileFromRepository(this.driver, this.repositoryName, path);
  }

  async list(path: string): Promise<WorkspaceListRpcResult> {
    return listRepository(this.driver, this.repositoryName, path);
  }

  async stat(path: string): Promise<WorkspaceStatRpcResult> {
    return statRepository(this.driver, this.repositoryName, path);
  }

  async delete(path: string): Promise<WorkspaceDeleteRpcResult> {
    return deleteFromRepository(this.driver, this.repositoryName, path);
  }

  async sessionMkdir(id: string, path: string): Promise<WorkspaceSessionMkdirRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;
    return mkdirInRepository(this.driver, id, path);
  }

  async sessionWriteFile(id: string, path: string, contents: Uint8Array): Promise<WorkspaceSessionWriteRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;
    return writeFileInRepository(this.driver, id, path, contents);
  }

  async sessionWriteTreeBatch(id: string, root: string, entries: WorkspaceTreeEntry[]): Promise<WorkspaceSessionWriteTreeBatchRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;

    const rootSegments = parseWorkspacePath(root, { allowRoot: true });
    if (Result.isError(rootSegments)) {
      return toRpcError(rootSegments.error);
    }

    for (const entry of entries) {
      const relative = parseRelativeWorkspacePath(entry.path);
      if (Result.isError(relative)) {
        return toRpcError(relative.error);
      }
      const path = workspacePathFromSegments([...rootSegments.value, ...relative.value]);
      const written = await writeTreeFileInRepository(this.driver, id, path, entry.contents);
      if (written.status === "error") {
        return written;
      }
    }

    return { status: "ok" } as const;
  }

  async sessionReadFile(id: string, path: string): Promise<WorkspaceSessionReadRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;
    return readFileFromRepository(this.driver, id, path);
  }

  async sessionList(id: string, path: string): Promise<WorkspaceSessionListRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;
    return listRepository(this.driver, id, path);
  }

  async sessionStat(id: string, path: string): Promise<WorkspaceSessionStatRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;
    return statRepository(this.driver, id, path);
  }

  async sessionDelete(id: string, path: string): Promise<WorkspaceSessionDeleteRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;
    return deleteFromRepository(this.driver, id, path);
  }

  async sessionCommit(id: string): Promise<WorkspaceSessionCommitRpcResult> {
    const session = await this.getSession(id);
    if (session.status === "error") return session;

    try {
      const revision = await this.driver.applyWorkingCopy(this.repositoryName, id);
      await this.artifacts.delete(id);
      return { status: "ok", value: revision } as const;
    } catch (error) {
      return sessionNotFoundFromArtifacts(id, error);
    }
  }

  async sessionDiscard(id: string): Promise<WorkspaceSessionDiscardRpcResult> {
    try {
      const deleted = await this.artifacts.delete(id);
      if (!deleted) {
        return toRpcError(new SessionNotFoundError({ sessionId: id }));
      }
      return { status: "ok" } as const;
    } catch (error) {
      return sessionNotFoundFromArtifacts(id, error);
    }
  }
}

async function readFileFromRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toRpcError(parsed.error);
  }

  const stat = await driver.stat(repository, path);
  if (!stat) {
    return toRpcError(new PathNotFoundError({ path }));
  }
  if (stat.type === "directory") {
    return toRpcError(new IsDirectoryError({ path }));
  }

  const contents = await driver.readFile(repository, path);
  if (!contents) {
    return toRpcError(new PathNotFoundError({ path }));
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
    return toRpcError(parsed.error);
  }

  const stat = await driver.stat(repository, path);
  if (!stat) {
    return toRpcError(new PathNotFoundError({ path }));
  }
  if (stat.type !== "directory") {
    return toRpcError(new NotDirectoryError({ path }));
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
    return toRpcError(parsed.error);
  }

  const stat = await driver.stat(repository, path);
  if (!stat) {
    return toRpcError(new PathNotFoundError({ path }));
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
    return toRpcError(parsed.error);
  }

  const existing = await driver.stat(repository, path);
  if (existing) {
    return toRpcError(new PathAlreadyExistsError({ path }));
  }

  const parent = await driver.stat(repository, parentPath(path));
  if (!parent) {
    return toRpcError(new PathNotFoundError({ path: parentPath(path) }));
  }
  if (parent.type !== "directory") {
    return toRpcError(new NotDirectoryError({ path: parentPath(path) }));
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
    return toRpcError(parsed.error);
  }

  const existing = await driver.stat(repository, path);
  if (existing?.type === "directory") {
    return toRpcError(new IsDirectoryError({ path }));
  }

  const parent = await driver.stat(repository, parentPath(path));
  if (parent && parent.type !== "directory") {
    return toRpcError(new NotDirectoryError({ path: parentPath(path) }));
  }

  await driver.writeFile(repository, path, contents);
  return { status: "ok" } as const;
}

async function writeTreeFileInRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
  contents: Uint8Array,
): Promise<WorkspaceSessionWriteTreeBatchRpcResult> {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toRpcError(parsed.error);
  }

  const existing = await driver.stat(repository, path);
  if (existing?.type === "directory") {
    return toRpcError(new IsDirectoryError({ path }));
  }

  await driver.writeFile(repository, path, contents);
  return { status: "ok" } as const;
}

async function deleteFromRepository(
  driver: ArtifactsWorkspaceDriver,
  repository: string,
  path: string,
) {
  const parsed = parseWorkspacePath(path, { allowRoot: false });
  if (Result.isError(parsed)) {
    return toRpcError(parsed.error);
  }

  const stat = await driver.stat(repository, path);
  if (!stat) {
    return toRpcError(new PathNotFoundError({ path }));
  }
  if (stat.type === "directory") {
    const entries = await driver.list(repository, path);
    if (entries.length > 0) {
      return toRpcError(new DirectoryNotEmptyError({ path }));
    }
    return { status: "ok" } as const;
  }

  await driver.deleteFile(repository, path);
  return { status: "ok" } as const;
}

function sessionNotFoundFromArtifacts(id: string, _error: unknown): Extract<WorkspaceSessionInfoRpcResult, { status: "error" }> {
  return toRpcError(new SessionNotFoundError({ sessionId: id }));
}

function createLazyIsomorphicGitArtifactsWorkspaceDriver(artifacts: ArtifactsBindingClient): ArtifactsWorkspaceDriver {
  return new LazyIsomorphicGitArtifactsWorkspaceDriver(artifacts);
}

class LazyIsomorphicGitArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  private driver?: Promise<ArtifactsWorkspaceDriver>;

  constructor(private readonly artifacts: ArtifactsBindingClient) {}

  repositoryExists(repository: string): Promise<boolean> {
    return this.load().then((driver) => driver.repositoryExists(repository));
  }

  readFile(repository: string, path: string): Promise<Uint8Array | null> {
    return this.load().then((driver) => driver.readFile(repository, path));
  }

  list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    return this.load().then((driver) => driver.list(repository, path));
  }

  stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    return this.load().then((driver) => driver.stat(repository, path));
  }

  writeFile(repository: string, path: string, contents: Uint8Array): Promise<void> {
    return this.load().then((driver) => driver.writeFile(repository, path, contents));
  }

  deleteFile(repository: string, path: string): Promise<void> {
    return this.load().then((driver) => driver.deleteFile(repository, path));
  }

  applyWorkingCopy(baseRepository: string, workingCopyRepository: string): Promise<WorkspaceRevision> {
    return this.load().then((driver) => driver.applyWorkingCopy(baseRepository, workingCopyRepository));
  }

  private load(): Promise<ArtifactsWorkspaceDriver> {
    this.driver ??= import("./isomorphic-git-driver").then((module) => module.createIsomorphicGitArtifactsWorkspaceDriver(this.artifacts));
    return this.driver;
  }
}

