import { Result } from "better-result";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src";
import {
  resetArtifactsWorkspaceDriverFactoryForTests,
  setArtifactsWorkspaceDriverFactoryForTests,
  type ArtifactsBindingClient,
  type ArtifactsRepoClient,
  type ArtifactsWorkspaceDriver,
} from "../src/workspace/artifacts/workspace-object-client";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function text(value: Uint8Array): string {
  return decoder.decode(value);
}

describe("Artifacts-backed Workspace product API", () => {
  afterEach(() => {
    resetArtifactsWorkspaceDriverFactoryForTests();
  });

  it("constructs with the default internal Git driver", () => {
    const workspace = Workspace.fromArtifacts(new FakeArtifactsBinding(new FakeArtifactsWorkspaceDriver({})), "repo");

    expect(workspace.files).toBeDefined();
  });

  it("uses Artifacts forks as isolated working copies", async () => {
    const driver = new FakeArtifactsWorkspaceDriver({
      repo: {
        "/README.md": bytes("# Current"),
      },
    });
    const artifacts = new FakeArtifactsBinding(driver);
    setArtifactsWorkspaceDriverFactoryForTests(() => driver);

    const workspace = Workspace.fromArtifacts(artifacts, "repo");
    const copy = await workspace.files.copy("agent-work");
    expect(Result.isOk(copy)).toBe(true);
    if (Result.isError(copy)) {
      throw new Error("copy failed");
    }

    const write = await copy.value.files.writeTree("/", [
      { path: "README.md", contents: bytes("# Edited") },
      { path: "src/index.ts", contents: bytes("export const ok = true;\n") },
    ]);
    const currentBeforeApply = await workspace.files.read("/README.md");
    const apply = await copy.value.apply();
    const currentAfterApply = await workspace.files.read("/README.md");
    const newFileAfterApply = await workspace.files.read("/src/index.ts");

    expect(Result.isOk(write)).toBe(true);
    expect(Result.isOk(currentBeforeApply)).toBe(true);
    if (Result.isOk(currentBeforeApply)) {
      expect(text(currentBeforeApply.value)).toBe("# Current");
    }
    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(currentAfterApply)).toBe(true);
    expect(Result.isOk(newFileAfterApply)).toBe(true);
    if (Result.isOk(currentAfterApply)) {
      expect(text(currentAfterApply.value)).toBe("# Edited");
    }
    if (Result.isOk(newFileAfterApply)) {
      expect(text(newFileAfterApply.value)).toBe("export const ok = true;\n");
    }
    expect(driver.deletedRepositories).toEqual([copy.value.id]);
  });
});

type Tree = Record<string, Uint8Array>;

class FakeArtifactsBinding implements ArtifactsBindingClient {
  constructor(private readonly driver: FakeArtifactsWorkspaceDriver) {}

  async get(name: string): Promise<ArtifactsRepoClient> {
    if (!this.driver.hasRepository(name)) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${name}`);
    }
    return new FakeArtifactsRepo(this.driver, name);
  }

  async delete(name: string): Promise<boolean> {
    return this.driver.deleteRepository(name);
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

class FakeArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  readonly deletedRepositories: string[] = [];
  private readonly repositories = new Map<string, Tree>();

  constructor(initial: Record<string, Tree>) {
    for (const [name, tree] of Object.entries(initial)) {
      this.repositories.set(name, cloneTree(tree));
    }
  }

  hasRepository(name: string): boolean {
    return this.repositories.has(name);
  }

  async repositoryExists(name: string): Promise<boolean> {
    return this.hasRepository(name);
  }

  forkRepository(source: string, target: string): void {
    const tree = this.repositories.get(source);
    if (!tree) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${source}`);
    }
    this.repositories.set(target, cloneTree(tree));
  }

  deleteRepository(name: string): boolean {
    const deleted = this.repositories.delete(name);
    if (deleted) {
      this.deletedRepositories.push(name);
    }
    return deleted;
  }

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    const contents = this.repositories.get(repository)?.[path];
    return contents ? new Uint8Array(contents) : null;
  }

  async list(repository: string, path: string) {
    const tree = this.repositories.get(repository);
    if (!tree) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${repository}`);
    }
    const prefix = path === "/" ? "/" : `${path}/`;
    const entries = new Map<string, "file" | "directory">();
    for (const filePath of Object.keys(tree)) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const rest = filePath.slice(prefix.length);
      if (!rest) {
        continue;
      }
      const [name, ...remaining] = rest.split("/");
      entries.set(name, remaining.length === 0 ? "file" : "directory");
    }
    return [...entries].sort(([left], [right]) => left.localeCompare(right)).map(([name, type]) => ({
      name,
      path: path === "/" ? `/${name}` : `${path}/${name}`,
      type,
    }));
  }

  async stat(repository: string, path: string) {
    const tree = this.repositories.get(repository);
    if (!tree) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${repository}`);
    }
    const file = tree[path];
    if (file) {
      return { path, type: "file" as const, size: file.byteLength, createdAt: 0, updatedAt: 0 };
    }
    const prefix = path === "/" ? "/" : `${path}/`;
    if (path === "/" || Object.keys(tree).some((filePath) => filePath.startsWith(prefix))) {
      return { path, type: "directory" as const, size: null, createdAt: 0, updatedAt: 0 };
    }
    return null;
  }

  async writeFile(repository: string, path: string, contents: Uint8Array): Promise<void> {
    const tree = this.repositories.get(repository);
    if (!tree) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${repository}`);
    }
    tree[path] = new Uint8Array(contents);
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    const tree = this.repositories.get(repository);
    if (!tree) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${repository}`);
    }
    delete tree[path];
  }

  async applyWorkingCopy(baseRepository: string, workingCopyRepository: string): Promise<{ revisionId: string; createdAt: number }> {
    const copy = this.repositories.get(workingCopyRepository);
    if (!copy) {
      throw artifactsError("NOT_FOUND", `Repository not found: ${workingCopyRepository}`);
    }
    this.repositories.set(baseRepository, cloneTree(copy));
    return { revisionId: "artifact-revision", createdAt: 123 };
  }
}

function cloneTree(tree: Tree): Tree {
  return Object.fromEntries(Object.entries(tree).map(([path, contents]) => [path, new Uint8Array(contents)]));
}

function artifactsError(code: string, message: string): Error & { name: "ArtifactsError"; code: string; numericCode: number } {
  return Object.assign(new Error(message), { name: "ArtifactsError" as const, code, numericCode: 1 });
}
