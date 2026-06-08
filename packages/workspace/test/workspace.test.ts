import { Result } from "better-result";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src";
import { createFakeArtifacts, FakeArtifactsBinding, FakeArtifactsWorkspaceDriver, resetFakeArtifacts } from "./fake-artifacts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function text(value: Uint8Array): string {
  return textDecoder.decode(value);
}

async function* asyncEntries(entries: Array<{ path: string; contents: Uint8Array }>) {
  for (const entry of entries) {
    yield entry;
  }
}

function closeableFailingAsyncEntries() {
  let closed = false;
  const source = {
    async *[Symbol.asyncIterator]() {
      try {
        yield { path: "before.txt", contents: bytes("before") };
        throw new Error("source failed");
      } finally {
        closed = true;
      }
    },
    get closed() {
      return closed;
    },
  };
  return source;
}

describe("Workspace", () => {
  afterEach(() => resetFakeArtifacts());

  it("constructs with the default internal Git driver", () => {
    const artifacts = new FakeArtifactsBinding(new FakeArtifactsWorkspaceDriver({}));
    const workspace = Workspace.fromArtifacts({ artifacts, object: createFakeArtifacts().object, name: "repo" });

    expect(workspace.files).toBeDefined();
  });


  it("returns Result errors when the Artifacts repository is missing", async () => {
    const { workspace } = createWorkspace({});

    const read = await workspace.files.read("/missing.txt");
    const list = await workspace.files.list("/");
    const stat = await workspace.files.stat("/");

    expect(Result.isError(read)).toBe(true);
    expect(Result.isError(list)).toBe(true);
    expect(Result.isError(stat)).toBe(true);
    if (Result.isError(read)) expect(read.error).toMatchObject({ tag: "PathNotFoundError" });
    if (Result.isError(list)) expect(list.error).toMatchObject({ tag: "PathNotFoundError" });
    if (Result.isError(stat)) expect(stat.error).toMatchObject({ tag: "PathNotFoundError" });
  });

  it("works with current files through Result values", async () => {
    const { workspace } = createWorkspace({ repo: {} });

    const write = await workspace.files.write("/hello.txt", bytes("hello"));
    const read = await workspace.files.read("/hello.txt");

    expect(Result.isOk(write)).toBe(true);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) expect(text(read.value)).toBe("hello");
  });

  it("writes async file trees into isolated copies before apply", async () => {
    const { workspace, driver } = createWorkspace({ repo: {} });
    const copy = await workspace.files.copy("import-tree");
    if (Result.isError(copy)) throw new Error("copy failed");

    const writeTree = await copy.value.files.writeTree("/imports/repo", asyncEntries([
      { path: "README.md", contents: bytes("# Draft") },
      { path: "src/index.ts", contents: bytes("export const draft = true;") },
    ]));
    const currentBeforeApply = await workspace.files.read("/imports/repo/README.md");
    const apply = await copy.value.apply();
    const currentAfterApply = await workspace.files.read("/imports/repo/README.md");

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isError(currentBeforeApply)).toBe(true);
    if (Result.isError(currentBeforeApply)) {
      expect(currentBeforeApply.error).toMatchObject({ tag: "PathNotFoundError" });
    }
    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(currentAfterApply)).toBe(true);
    if (Result.isOk(currentAfterApply)) expect(text(currentAfterApply.value)).toBe("# Draft");
    expect(driver.writeBatches).toEqual([
      {
        repository: copy.value.id,
        files: [
          { path: "/imports/repo/README.md", contents: bytes("# Draft") },
          { path: "/imports/repo/src/index.ts", contents: bytes("export const draft = true;") },
        ],
      },
    ]);
  });

  it("lets later writeTree entries overwrite earlier entries", async () => {
    const { workspace } = createWorkspace({ repo: {} });
    const copy = await workspace.files.copy("duplicate-import");
    if (Result.isError(copy)) throw new Error("copy failed");

    const writeTree = await copy.value.files.writeTree("/imports", [
      { path: "README.md", contents: bytes("one") },
      { path: "README.md", contents: bytes("two") },
    ]);
    await copy.value.apply();
    const read = await workspace.files.read("/imports/README.md");

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) expect(text(read.value)).toBe("two");
  });

  it("returns domain errors for file and directory collisions within a writeTree batch", async () => {
    const { workspace, driver } = createWorkspace({ repo: {} });
    const copy = await workspace.files.copy("conflicting-import");
    if (Result.isError(copy)) throw new Error("copy failed");

    const writeTree = await copy.value.files.writeTree("/imports", [
      { path: "README.md/nested.txt", contents: bytes("nested") },
      { path: "README.md", contents: bytes("file") },
    ]);

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "IsDirectoryError", path: "/imports/README.md" });
    }
    expect(driver.writeBatches).toEqual([]);
  });

  it("does not change current files when copy writeTree has an invalid relative path", async () => {
    const { workspace } = createWorkspace({ repo: {} });
    const copy = await workspace.files.copy("invalid-import");
    if (Result.isError(copy)) throw new Error("copy failed");

    const writeTree = await copy.value.files.writeTree("/imports/repo", [
      { path: "README.md", contents: bytes("# Repo") },
      { path: "../escape.txt", contents: bytes("no") },
    ]);
    const rootStat = await workspace.files.stat("/imports");

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "InvalidPathError", path: "../escape.txt" });
    }
    expect(Result.isError(rootStat)).toBe(true);
  });

  it("returns Result errors and closes the source when a source iterable fails", async () => {
    const { workspace } = createWorkspace({ repo: {} });
    const copy = await workspace.files.copy("source-error-import");
    if (Result.isError(copy)) throw new Error("copy failed");
    const source = closeableFailingAsyncEntries();

    const writeTree = await copy.value.files.writeTree("/imports", source);
    const discard = await copy.value.discard();
    const current = await workspace.files.read("/imports/before.txt");

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) expect(writeTree.error).toMatchObject({ tag: "WorkspaceTreeSourceError" });
    expect(source.closed).toBe(true);
    expect(Result.isOk(discard)).toBe(true);
    expect(Result.isError(current)).toBe(true);
  });

  it("returns Result errors when a single writeTree entry exceeds the batch byte limit", async () => {
    const { workspace, driver } = createWorkspace({ repo: {} });
    const copy = await workspace.files.copy("oversized-import");
    if (Result.isError(copy)) throw new Error("copy failed");

    const writeTree = await copy.value.files.writeTree("/imports", [
      { path: "huge.bin", contents: new Uint8Array(17 * 1024 * 1024) },
    ]);

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "WorkspaceTreeEntryTooLargeError", path: "huge.bin" });
    }
    expect(driver.writes).toEqual([]);
  });

  it("applies, recovers, and discards isolated file copies", async () => {
    const { workspace, artifacts } = createWorkspace({ repo: { "/note.txt": bytes("current") } });
    const copy = await workspace.files.copy("edit-note");
    if (Result.isError(copy)) throw new Error("copy failed");

    await copy.value.files.write("/note.txt", bytes("draft"));
    const recovered = await workspace.files.getCopy(copy.value.id);
    if (Result.isError(recovered)) throw new Error("recover failed");
    await recovered.value.files.write("/other.txt", bytes("other"));
    const apply = await recovered.value.apply();

    const note = await workspace.files.read("/note.txt");
    const other = await workspace.files.read("/other.txt");

    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(note)).toBe(true);
    expect(Result.isOk(other)).toBe(true);
    if (Result.isOk(note)) expect(text(note.value)).toBe("draft");
    if (Result.isOk(other)) expect(text(other.value)).toBe("other");
    expect(artifacts.deletedRepositories).toEqual([copy.value.id]);

    const discardCopy = await workspace.files.copy("discard-note");
    if (Result.isError(discardCopy)) throw new Error("copy failed");
    await discardCopy.value.files.write("/note.txt", bytes("discarded"));
    const discard = await discardCopy.value.discard();
    const current = await workspace.files.read("/note.txt");

    expect(Result.isOk(discard)).toBe(true);
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) expect(text(current.value)).toBe("draft");
  });

  it("records working copy repository access in WorkspaceObject", async () => {
    const { workspace, object } = createWorkspace({ repo: { "/note.txt": bytes("current") } });

    const copy = await workspace.files.copy("metadata");
    if (Result.isError(copy)) throw new Error("copy failed");

    await expect(object.repositoryAccess(copy.value.id)).resolves.toEqual({
      repository: copy.value.id,
      remote: `https://git.example/${copy.value.id}.git`,
      defaultBranch: "main",
      baseRepository: "repo",
    });
  });

  it("records working copy metadata when Artifacts fork omits default branch", async () => {
    const { workspace, artifacts, driver, object } = createWorkspace({ repo: { "/note.txt": bytes("current") } });
    artifacts.get = async () => ({
      name: "repo",
      fork: async (name: string) => {
        driver.forkRepository("repo", name);
        return { name, remote: `https://git.example/${name}.git` };
      },
    });

    const copy = await workspace.files.copy("metadata");
    if (Result.isError(copy)) throw new Error("copy failed");

    await expect(object.repositoryAccess(copy.value.id)).resolves.toEqual({
      repository: copy.value.id,
      remote: `https://git.example/${copy.value.id}.git`,
      defaultBranch: "main",
      baseRepository: "repo",
    });
  });

  it("attaches a file copy to a filesystem host and reconciles changed files", async () => {
    const { workspace } = createWorkspace({ repo: { "/photos/original.txt": bytes("original") } });
    const host = new FakeMountHost();
    const copy = await workspace.files.copy("edit-photo");
    if (Result.isError(copy)) throw new Error("copy failed");

    const mount = await copy.value.files.attach(host, "/workspace");
    expect(Result.isOk(mount)).toBe(true);
    if (Result.isError(mount)) throw new Error("attach failed");

    host.files["/workspace/photos/current.txt"] = bytes("edited");
    const reconcile = await mount.value.reconcile();
    const apply = await copy.value.apply();
    const current = await workspace.files.read("/photos/current.txt");

    expect(mount.value.path).toBe("/workspace");
    expect(Result.isOk(reconcile)).toBe(true);
    if (Result.isOk(reconcile)) expect(reconcile.value.created).toContain("/photos/current.txt");
    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) expect(text(current.value)).toBe("edited");
  });

  it("creates scoped file capabilities from file copies", async () => {
    const { workspace } = createWorkspace({ repo: { "/photos/current": bytes("photo") } });
    const copy = await workspace.files.copy("dynamic-worker");
    if (Result.isError(copy)) throw new Error("copy failed");

    const capability = copy.value.files.scoped({ read: "/photos/**", write: "/notes/**" });

    await expect(capability.readFile("/photos/current")).resolves.toEqual({ status: "ok", value: bytes("photo") });
    await expect(capability.writeFile("/notes/edit-summary.md", bytes("note"))).resolves.toEqual({ status: "ok" });
    await expect(capability.writeFile("/photos/current", bytes("updated"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "ScopedWorkspaceAccessError" },
    });
    expect("apply" in capability).toBe(false);
    expect("discard" in capability).toBe(false);
  });
});

function createWorkspace(initial: Record<string, Record<string, Uint8Array>>) {
  const { artifacts, driver, object } = createFakeArtifacts(initial);
  void object.recordCurrentRepository({
    repository: "repo",
    remote: "https://git.example/repo.git",
    defaultBranch: "main",
  });
  return { workspace: Workspace.fromArtifacts({ artifacts, object, name: "repo" }), artifacts, driver, object };
}

class FakeMountHost {
  readonly directories = new Set<string>();
  readonly files: Record<string, Uint8Array> = {};

  async resetDirectory(path: string) {
    for (const filePath of Object.keys(this.files)) {
      if (filePath === path || filePath.startsWith(`${path}/`)) delete this.files[filePath];
    }
  }

  async mkdir(path: string, _options: { recursive: boolean }) {
    this.directories.add(path);
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.files[path] = contents;
  }

  async readFile(path: string) {
    const content = this.files[path];
    if (!content) throw new Error(`missing fake mount file: ${path}`);
    return content;
  }

  async listTree(path: string) {
    const prefix = `${path}/`;
    return [
      ...[...this.directories]
        .filter((directoryPath) => directoryPath !== path && directoryPath.startsWith(prefix))
        .map((directoryPath) => ({ path: directoryPath, type: "directory" as const })),
      ...Object.keys(this.files)
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => ({ path: filePath, type: "file" as const })),
    ];
  }
}
