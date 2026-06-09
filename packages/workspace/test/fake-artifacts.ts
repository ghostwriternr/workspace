import type { WorkspaceEntry, WorkspaceStat } from "../src";
import {
  resetArtifactsWorkspaceDriverFactoryForTests,
  setArtifactsWorkspaceDriverFactoryForTests,
  type ArtifactsWorkspaceDriver,
} from "../src/artifacts/authority";
import type { ArtifactsBindingClient, ArtifactsRepoClient } from "../src/artifacts/binding";
import type { WorkspaceRevision } from "../src/model/entries";
import type {
  WorkspaceCopyRecord,
  WorkspaceCurrentRepositoryRecord,
  WorkspaceObjectClient,
} from "../src/workspace-object";

export type Tree = Record<string, Uint8Array>;

export type FakeArtifacts = {
  artifacts: FakeArtifactsBinding;
  driver: FakeArtifactsWorkspaceDriver;
  object: FakeWorkspaceObject;
};

export function createFakeArtifacts(initial: Record<string, Tree> = {}): FakeArtifacts {
  const driver = new FakeArtifactsWorkspaceDriver(initial);
  const artifacts = new FakeArtifactsBinding(driver);
  const object = new FakeWorkspaceObject();
  setArtifactsWorkspaceDriverFactoryForTests(() => driver);
  return { artifacts, driver, object };
}

export function resetFakeArtifacts(): void {
  resetArtifactsWorkspaceDriverFactoryForTests();
}

export class FakeWorkspaceObject implements WorkspaceObjectClient {
  private current?: WorkspaceCurrentRepositoryRecord;
  private readonly copies = new Map<string, WorkspaceCopyRecord>();

  async recordCurrentRepository(record: WorkspaceCurrentRepositoryRecord): Promise<void> {
    this.current = { ...record };
  }

  async currentRepository(): Promise<WorkspaceCurrentRepositoryRecord | undefined> {
    return this.current ? { ...this.current } : undefined;
  }

  async recordCopy(record: WorkspaceCopyRecord): Promise<void> {
    this.copies.set(record.copyId, { ...record });
  }

  async copy(copyId: string): Promise<WorkspaceCopyRecord | undefined> {
    const copy = this.copies.get(copyId);
    return copy ? { ...copy } : undefined;
  }

  async deleteCopy(copyId: string): Promise<void> {
    this.copies.delete(copyId);
  }
}

export class FakeArtifactsBinding implements ArtifactsBindingClient {
  readonly createdRepositories: string[] = [];
  readonly deletedRepositories: string[] = [];

  constructor(readonly driver: FakeArtifactsWorkspaceDriver) {}

  async create(name: string): Promise<{ name: string; remote: string; defaultBranch?: string }> {
    this.createdRepositories.push(name);
    this.driver.createRepository(name);
    return repositoryResult(name);
  }

  async get(name: string): Promise<ArtifactsRepoClient> {
    if (!(await this.driver.repositoryExists(name))) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${name}`);
    }
    return new FakeArtifactsRepo(name);
  }

  async delete(name: string): Promise<boolean> {
    const deleted = this.driver.deleteRepository(name);
    if (deleted) {
      this.deletedRepositories.push(name);
    }
    return deleted;
  }
}

class FakeArtifactsRepo implements ArtifactsRepoClient {
  constructor(readonly name: string) {}
}

export class FakeArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  readonly writeBatches: Array<{ repository: string; files: Array<{ path: string; contents: Uint8Array }> }> = [];
  readonly writes: Array<{ repository: string; path: string; contents: Uint8Array }> = [];
  failWrites = false;
  private readonly repositories = new Map<string, Tree>();
  private readonly revisions = new Map<string, string>();
  private readonly workingCopies = new Map<string, { baseRepository: string; tree: Tree }>();

  constructor(initial: Record<string, Tree>) {
    for (const [name, tree] of Object.entries(initial)) {
      this.repositories.set(name, cloneTree(tree));
      if (Object.keys(tree).length > 0) {
        this.revisions.set(name, `revision-${name}-0`);
      }
    }
  }

  install(): this {
    setArtifactsWorkspaceDriverFactoryForTests(() => this);
    return this;
  }

  createRepository(name: string): void {
    this.repositories.set(name, {});
  }

  hasRepository(repository: string): boolean {
    return this.repositories.has(repository);
  }

  async repositoryExists(repository: string): Promise<boolean> {
    return this.hasRepository(repository);
  }

  deleteRepository(repository: string): boolean {
    return this.repositories.delete(repository);
  }

  seedWorkingCopy(baseRepository: string, copyId: string, tree: Tree): void {
    this.workingCopies.set(copyId, {
      baseRepository,
      tree: cloneTree(tree),
    });
  }

  file(repository: string, path: string): Uint8Array | undefined {
    return (this.repositories.get(repository) ?? this.workingCopies.get(repository)?.tree)?.[path];
  }

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    const contents = this.repositories.get(repository)?.[path];
    return contents ? new Uint8Array(contents) : null;
  }

  async list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    return listTree(this.tree(repository), path);
  }

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    return statTree(this.tree(repository), path);
  }

  async writeFile(repository: string, path: string, contents: Uint8Array): Promise<void> {
    await this.writeFiles(repository, [{ path, contents }]);
  }

  async writeFiles(repository: string, files: Array<{ path: string; contents: Uint8Array }>): Promise<void> {
    if (this.failWrites) throw new Error("write failed");
    const tree = this.tree(repository);
    const copied = files.map((file) => ({ path: file.path, contents: new Uint8Array(file.contents) }));
    for (const file of copied) {
      tree[file.path] = new Uint8Array(file.contents);
      this.writes.push({ repository, path: file.path, contents: new Uint8Array(file.contents) });
    }
    this.revisions.set(repository, `revision-${repository}-${this.writeBatches.length + 1}`);
    this.writeBatches.push({ repository, files: copied });
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    delete this.tree(repository)[path];
  }

  async currentRevision(repository: string): Promise<string | undefined> {
    this.tree(repository);
    return this.revisions.get(repository);
  }

  async createWorkingCopy(baseRepository: string, copyId: string): Promise<string | undefined> {
    const baseRevisionId = await this.currentRevision(baseRepository);
    this.workingCopies.set(copyId, {
      baseRepository,
      tree: cloneTree(this.tree(baseRepository)),
    });
    return baseRevisionId;
  }


  async readWorkingCopyFile(_baseRepository: string, copyId: string, path: string): Promise<Uint8Array | null> {
    const contents = this.workingCopyTree(copyId)[path];
    return contents ? new Uint8Array(contents) : null;
  }

  async listWorkingCopy(_baseRepository: string, copyId: string, path: string): Promise<WorkspaceEntry[]> {
    return listTree(this.workingCopyTree(copyId), path);
  }

  async statWorkingCopy(_baseRepository: string, copyId: string, path: string): Promise<WorkspaceStat | null> {
    return statTree(this.workingCopyTree(copyId), path);
  }

  async writeWorkingCopyFile(baseRepository: string, copyId: string, path: string, contents: Uint8Array): Promise<void> {
    await this.writeWorkingCopyFiles(baseRepository, copyId, [{ path, contents }]);
  }

  async writeWorkingCopyFiles(_baseRepository: string, copyId: string, files: Array<{ path: string; contents: Uint8Array }>): Promise<void> {
    if (this.failWrites) throw new Error("write failed");
    const tree = this.workingCopyTree(copyId);
    const copied = files.map((file) => ({ path: file.path, contents: new Uint8Array(file.contents) }));
    for (const file of copied) {
      tree[file.path] = new Uint8Array(file.contents);
      this.writes.push({ repository: copyId, path: file.path, contents: new Uint8Array(file.contents) });
    }
    this.writeBatches.push({ repository: copyId, files: copied });
  }

  async deleteWorkingCopyFile(_baseRepository: string, copyId: string, path: string): Promise<void> {
    delete this.workingCopyTree(copyId)[path];
  }

  deleteWorkingCopyRef(copyId: string): void {
    this.workingCopies.delete(copyId);
  }

  async applyWorkingCopy(baseRepository: string, copyId: string): Promise<WorkspaceRevision> {
    this.repositories.set(baseRepository, cloneTree(this.workingCopyTree(copyId)));
    const revisionId = Object.keys(this.tree(baseRepository)).length === 0 ? "empty-repository" : `revision-${copyId}`;
    this.revisions.set(baseRepository, revisionId);
    return { revisionId, createdAt: 1 };
  }

  async discardWorkingCopy(_baseRepository: string, copyId: string): Promise<void> {
    if (!this.workingCopies.delete(copyId)) {
      throw artifactsError("NOT_FOUND", `Working copy not found: ${copyId}`);
    }
  }

  private workingCopyTree(copyId: string): Tree {
    const copy = this.workingCopies.get(copyId);
    if (!copy) throw artifactsError("NOT_FOUND", `Working copy not found: ${copyId}`);
    return copy.tree;
  }

  private tree(repository: string): Tree {
    const tree = this.repositories.get(repository);
    if (!tree) throw artifactsError("NOT_FOUND", `Repository not found: ${repository}`);
    return tree;
  }
}

function listTree(tree: Tree, path: string): WorkspaceEntry[] {
  const prefix = path === "/" ? "/" : `${path}/`;
  const entries = new Map<string, "directory" | "file">();
  for (const filePath of Object.keys(tree)) {
    if (!filePath.startsWith(prefix)) continue;
    const rest = filePath.slice(prefix.length);
    if (!rest) continue;
    const [name, ...remaining] = rest.split("/");
    entries.set(name, remaining.length === 0 ? "file" : "directory");
  }
  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => ({ name, path: path === "/" ? `/${name}` : `${path}/${name}`, type }));
}

function statTree(tree: Tree, path: string): WorkspaceStat | null {
  const file = tree[path];
  if (file) {
    return { path, type: "file", size: file.byteLength, createdAt: 0, updatedAt: 0 };
  }
  const prefix = path === "/" ? "/" : `${path}/`;
  if (path === "/" || Object.keys(tree).some((filePath) => filePath.startsWith(prefix))) {
    return { path, type: "directory", size: null, createdAt: 0, updatedAt: 0 };
  }
  return null;
}

function cloneTree(tree: Tree): Tree {
  return Object.fromEntries(Object.entries(tree).map(([path, contents]) => [path, new Uint8Array(contents)]));
}

function repositoryResult(name: string): { name: string; remote: string; defaultBranch: string } {
  return {
    name,
    remote: `https://git.example/${name}.git`,
    defaultBranch: "main",
  };
}

function artifactsError(code: string, message: string): Error & { name: "ArtifactsError"; code: string; numericCode: number } {
  return Object.assign(new Error(message), { name: "ArtifactsError" as const, code, numericCode: 1 });
}
