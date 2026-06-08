import type {
  ArtifactsBindingClient,
  ArtifactsRepoClient,
  ArtifactsWorkspaceDriver,
} from "../src/workspace/artifacts/workspace-backend-client";
import type { WorkspaceEntry, WorkspaceStat } from "../src";
import type { WorkspaceRevision } from "../src/workspace/model/rpc";

export type Tree = Record<string, Uint8Array>;

export class FakeArtifactsBinding implements ArtifactsBindingClient {
  readonly deletedRepositories: string[] = [];

  constructor(readonly driver: FakeArtifactsWorkspaceDriver) {}

  async create(name: string): Promise<{ name: string }> {
    this.driver.createRepository(name);
    return { name };
  }

  async get(name: string): Promise<ArtifactsRepoClient> {
    if (!(await this.driver.repositoryExists(name))) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${name}`);
    }
    return new FakeArtifactsRepo(this.driver, name);
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
  constructor(
    private readonly driver: FakeArtifactsWorkspaceDriver,
    readonly name: string,
  ) {}

  async fork(name: string): Promise<{ name: string }> {
    this.driver.forkRepository(this.name, name);
    return { name };
  }
}

export class FakeArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  readonly writes: Array<{ repository: string; path: string; contents: Uint8Array }> = [];
  failWrites = false;
  private readonly repositories = new Map<string, Tree>();

  constructor(initial: Record<string, Tree>) {
    for (const [name, tree] of Object.entries(initial)) {
      this.repositories.set(name, cloneTree(tree));
    }
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

  forkRepository(source: string, target: string): void {
    this.repositories.set(target, cloneTree(this.tree(source)));
  }

  deleteRepository(repository: string): boolean {
    return this.repositories.delete(repository);
  }

  file(repository: string, path: string): Uint8Array | undefined {
    return this.repositories.get(repository)?.[path];
  }

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    const contents = this.repositories.get(repository)?.[path];
    return contents ? new Uint8Array(contents) : null;
  }

  async list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    const tree = this.tree(repository);
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

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    const tree = this.tree(repository);
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

  async writeFile(repository: string, path: string, contents: Uint8Array): Promise<void> {
    if (this.failWrites) throw new Error("write failed");
    this.tree(repository)[path] = new Uint8Array(contents);
    this.writes.push({ repository, path, contents: new Uint8Array(contents) });
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    delete this.tree(repository)[path];
  }

  async applyWorkingCopy(baseRepository: string, workingCopyRepository: string): Promise<WorkspaceRevision> {
    this.repositories.set(baseRepository, cloneTree(this.tree(workingCopyRepository)));
    return { revisionId: `revision-${workingCopyRepository}`, createdAt: 1 };
  }

  private tree(repository: string): Tree {
    const tree = this.repositories.get(repository);
    if (!tree) throw artifactsError("NOT_FOUND", `Repository not found: ${repository}`);
    return tree;
  }
}

function cloneTree(tree: Tree): Tree {
  return Object.fromEntries(Object.entries(tree).map(([path, contents]) => [path, new Uint8Array(contents)]));
}

function artifactsError(code: string, message: string): Error & { name: "ArtifactsError"; code: string; numericCode: number } {
  return Object.assign(new Error(message), { name: "ArtifactsError" as const, code, numericCode: 1 });
}
