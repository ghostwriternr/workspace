import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.restoreAllMocks();
    resetFakeArtifacts();
  });

  it("constructs with the default internal Git driver", () => {
    const artifacts = new FakeArtifactsBinding(new FakeArtifactsWorkspaceDriver({}));
    const workspace = Workspace.bind({
      artifacts,
      objects: { getByName: () => createFakeArtifacts().object },
    }).get("repo");

    expect(workspace.files).toBeDefined();
  });

  it("binds Artifacts and WorkspaceObjects once for named workspaces", async () => {
    const { artifacts, object } = createFakeArtifacts({ repo: { "/README.md": bytes("hello") } });
    const requestedNames: string[] = [];
    const workspaces = Workspace.bind({
      artifacts,
      objects: {
        getByName(name: string) {
          requestedNames.push(name);
          return object;
        },
      },
    });

    const workspace = workspaces.get("repo");
    const read = await workspace.files.read("/README.md");

    expect(requestedNames).toEqual(["repo"]);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) expect(text(read.value)).toBe("hello");
  });

  it("adopts Artifacts repository access through the binding", async () => {
    const { artifacts, object } = createFakeArtifacts({ repo: { "/README.md": bytes("hello") } });
    const workspaces = Workspace.bind({ artifacts, objects: { getByName: () => object } });

    const adopted = await workspaces.adoptArtifactsRepository({
      name: "repo",
      repository: { remote: "https://git.example/repo.git", defaultBranch: "trunk" },
    });

    expect(Result.isOk(adopted)).toBe(true);
    await expect(object.currentRepository()).resolves.toEqual({
      repository: "repo",
      remote: "https://git.example/repo.git",
      defaultBranch: "trunk",
    });
  });

  it("returns Result errors when adopting Artifacts repository access metadata is incomplete", async () => {
    const { artifacts, object } = createFakeArtifacts({ repo: {} });
    const workspaces = Workspace.bind({ artifacts, objects: { getByName: () => object } });

    const adopted = await workspaces.adoptArtifactsRepository({
      name: "repo",
      repository: { defaultBranch: "main" },
    });

    expect(Result.isError(adopted)).toBe(true);
    if (Result.isError(adopted)) {
      expect(adopted.error).toEqual({
        tag: "WorkspaceArtifactsRepositoryAccessError",
        message: "Artifacts repository access metadata must include a remote URL.",
      });
    }
  });

  it("returns Result errors when the Artifacts repository is missing", async () => {
    const { workspace } = createWorkspace({});

    const copy = await workspace.copies.create({ label: "missing" });
    const read = await workspace.files.read("/missing.txt");
    const list = await workspace.files.list("/");
    const stat = await workspace.files.stat("/");
    const mkdir = await workspace.files.mkdir("/notes");
    const write = await workspace.files.write("/missing.txt", bytes("missing"));
    const deleted = await workspace.files.delete("/missing.txt");

    expect(Result.isError(copy)).toBe(true);
    expect(Result.isError(read)).toBe(true);
    expect(Result.isError(list)).toBe(true);
    expect(Result.isError(stat)).toBe(true);
    expect(Result.isError(mkdir)).toBe(true);
    expect(Result.isError(write)).toBe(true);
    expect(Result.isError(deleted)).toBe(true);
    if (Result.isError(copy)) expect(copy.error).toMatchObject({ tag: "WorkspaceCopyNotFoundError" });
    if (Result.isError(read)) expect(read.error).toMatchObject({ tag: "PathNotFoundError" });
    if (Result.isError(list)) expect(list.error).toMatchObject({ tag: "PathNotFoundError" });
    if (Result.isError(stat)) expect(stat.error).toMatchObject({ tag: "PathNotFoundError" });
    if (Result.isError(mkdir)) expect(mkdir.error).toMatchObject({ tag: "PathNotFoundError" });
    if (Result.isError(write)) expect(write.error).toMatchObject({ tag: "PathNotFoundError" });
    if (Result.isError(deleted)) expect(deleted.error).toMatchObject({ tag: "PathNotFoundError" });
  });

  it("does not hide unexpected Artifacts failures as missing copies", async () => {
    const { workspace, artifacts } = createWorkspace({ repo: { "/README.md": bytes("hello") } });
    artifacts.get = async () => {
      throw Object.assign(new Error("Artifacts unavailable"), {
        name: "ArtifactsError",
        code: "INTERNAL_ERROR",
      });
    };

    await expect(workspace.copies.create({ label: "agent-edit" })).rejects.toThrow("Artifacts unavailable");
  });

  it("works with current files through Result values", async () => {
    const { workspace } = createWorkspace({ repo: {} });

    const write = await workspace.files.write("/hello.txt", bytes("hello"));
    const read = await workspace.files.read("/hello.txt");

    expect(Result.isOk(write)).toBe(true);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) expect(text(read.value)).toBe("hello");
  });

  it("creates and recovers working copies from the copies API", async () => {
    const { workspace } = createWorkspace({ repo: { "/note.txt": bytes("current") } });
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);

    const created = await workspace.copies.create({ label: "agent-edit" });
    if (Result.isError(created)) throw new Error("copy failed");
    await created.value.files.write("/note.txt", bytes("draft"));
    const recovered = await workspace.copies.get(created.value.id);
    if (Result.isError(recovered)) throw new Error("recover failed");
    const read = await recovered.value.files.read("/note.txt");

    expect(created.value.label).toBe("agent-edit");
    expect(recovered.value.label).toBe("agent-edit");
    expect(recovered.value.createdAt).toBe(created.value.createdAt);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) expect(text(read.value)).toBe("draft");
  });

  it("keeps working copies inside the current Artifacts repository", async () => {
    const { workspace, artifacts, driver } = createWorkspace({ repo: { "/note.txt": bytes("current") } });

    const created = await workspace.copies.create({ label: "agent-edit" });
    if (Result.isError(created)) throw new Error("copy failed");
    await created.value.files.write("/note.txt", bytes("draft"));
    const apply = await created.value.apply();
    const current = await workspace.files.read("/note.txt");

    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) expect(text(current.value)).toBe("draft");
    expect(driver.hasRepository(created.value.id)).toBe(false);
    expect(artifacts.deletedRepositories).toEqual([]);
  });

  it("preserves current files when a working copy adds files", async () => {
    const { workspace } = createWorkspace({ repo: { "/README.md": bytes("readme") } });

    const created = await workspace.copies.create({ label: "add-note" });
    if (Result.isError(created)) throw new Error("copy failed");
    await created.value.files.write("/notes/summary.md", bytes("summary"));
    const apply = await created.value.apply();
    const readme = await workspace.files.read("/README.md");
    const note = await workspace.files.read("/notes/summary.md");

    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(readme)).toBe(true);
    expect(Result.isOk(note)).toBe(true);
    if (Result.isOk(readme)) expect(text(readme.value)).toBe("readme");
    if (Result.isOk(note)) expect(text(note.value)).toBe("summary");
  });

  it("writes and applies working copies from empty repositories", async () => {
    const { workspace } = createWorkspace({ repo: {} });

    const created = await workspace.copies.create({ label: "empty-base-edit" });
    if (Result.isError(created)) throw new Error("copy failed");
    await created.value.files.write("/note.txt", bytes("draft"));
    const draft = await created.value.files.read("/note.txt");
    const apply = await created.value.apply();
    const current = await workspace.files.read("/note.txt");

    expect(Result.isOk(draft)).toBe(true);
    if (Result.isOk(draft)) expect(text(draft.value)).toBe("draft");
    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) expect(text(current.value)).toBe("draft");
  });

  it("applies untouched working copies from empty repositories", async () => {
    const { workspace, object } = createWorkspace({ repo: {} });

    const created = await workspace.copies.create({ label: "empty-base-noop" });
    if (Result.isError(created)) throw new Error("copy failed");
    const apply = await created.value.apply();

    expect(Result.isOk(apply)).toBe(true);
    if (Result.isOk(apply)) expect(apply.value.revisionId).toBe("empty-repository");
    await expect(object.copy(created.value.id)).resolves.toBeUndefined();
  });

  it("discards working copy metadata when the hidden ref is already gone", async () => {
    const { workspace, driver, object } = createWorkspace({ repo: {} });

    const created = await workspace.copies.create({ label: "orphaned-ref" });
    if (Result.isError(created)) throw new Error("copy failed");
    driver.deleteWorkingCopyRef(created.value.id);
    const discard = await created.value.discard();

    expect(Result.isOk(discard)).toBe(true);
    await expect(object.copy(created.value.id)).resolves.toBeUndefined();
  });

  it("returns copy errors when hidden working copy refs disappear", async () => {
    const { workspace, driver } = createWorkspace({ repo: { "/note.txt": bytes("current") } });

    const created = await workspace.copies.create({ label: "orphaned-ref" });
    if (Result.isError(created)) throw new Error("copy failed");
    driver.deleteWorkingCopyRef(created.value.id);
    const read = await created.value.files.read("/note.txt");

    expect(Result.isError(read)).toBe(true);
    if (Result.isError(read)) {
      expect(read.error).toMatchObject({
        tag: "WorkspaceCopyNotFoundError",
        copyId: created.value.id,
      });
    }
  });

  it("keeps untouched empty-base copies readable after current files change", async () => {
    const { workspace } = createWorkspace({ repo: {} });
    const copy = await workspace.copies.create({ label: "empty-base" });
    if (Result.isError(copy)) throw new Error("copy failed");
    await workspace.files.write("/README.md", bytes("current"));

    const read = await copy.value.files.read("/README.md");
    await copy.value.files.write("/draft.txt", bytes("draft"));
    const apply = await copy.value.apply();

    expect(Result.isError(read)).toBe(true);
    if (Result.isError(read)) expect(read.error).toMatchObject({ tag: "PathNotFoundError" });
    expect(Result.isError(apply)).toBe(true);
    if (Result.isError(apply)) expect(apply.error).toMatchObject({ tag: "WorkspaceCopyStaleError" });
  });

  it("writes async file trees into isolated copies before apply", async () => {
    const { workspace, driver } = createWorkspace({ repo: {} });
    const copy = await workspace.copies.create({ label: "import-tree" });
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
    const copy = await workspace.copies.create({ label: "duplicate-import" });
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
    const copy = await workspace.copies.create({ label: "conflicting-import" });
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

  it("validates writeTree paths against existing working copy files", async () => {
    const { workspace, driver } = createWorkspace({ repo: {} });
    const copy = await workspace.copies.create({ label: "conflicting-copy" });
    if (Result.isError(copy)) throw new Error("copy failed");
    await copy.value.files.write("/notes", bytes("file"));

    const writeTree = await copy.value.files.writeTree("/", [
      { path: "notes/edit.md", contents: bytes("nested") },
    ]);

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "NotDirectoryError", path: "/notes" });
    }
    expect(driver.writeBatches).toHaveLength(1);
  });

  it("does not change current files when copy writeTree has an invalid relative path", async () => {
    const { workspace } = createWorkspace({ repo: {} });
    const copy = await workspace.copies.create({ label: "invalid-import" });
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
    const copy = await workspace.copies.create({ label: "source-error-import" });
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
    const copy = await workspace.copies.create({ label: "oversized-import" });
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
    const copy = await workspace.copies.create({ label: "edit-note" });
    if (Result.isError(copy)) throw new Error("copy failed");

    await copy.value.files.write("/note.txt", bytes("draft"));
    const recovered = await workspace.copies.get(copy.value.id);
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
    expect(artifacts.deletedRepositories).toEqual([]);

    const discardCopy = await workspace.copies.create({ label: "discard-note" });
    if (Result.isError(discardCopy)) throw new Error("copy failed");
    await discardCopy.value.files.write("/note.txt", bytes("discarded"));
    const discard = await discardCopy.value.discard();
    const current = await workspace.files.read("/note.txt");

    expect(Result.isOk(discard)).toBe(true);
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) expect(text(current.value)).toBe("draft");
  });

  it("rejects applying stale working copies", async () => {
    const { workspace } = createWorkspace({ repo: { "/note.txt": bytes("current") } });
    const first = await workspace.copies.create({ label: "first" });
    const second = await workspace.copies.create({ label: "second" });
    if (Result.isError(first)) throw new Error("copy failed");
    if (Result.isError(second)) throw new Error("copy failed");

    await first.value.files.write("/note.txt", bytes("first"));
    await second.value.files.write("/note.txt", bytes("second"));
    const firstApply = await first.value.apply();
    const secondApply = await second.value.apply();
    const current = await workspace.files.read("/note.txt");

    expect(Result.isOk(firstApply)).toBe(true);
    expect(Result.isError(secondApply)).toBe(true);
    if (Result.isError(secondApply)) {
      expect(secondApply.error).toMatchObject({
        tag: "WorkspaceCopyStaleError",
        copyId: second.value.id,
      });
    }
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) expect(text(current.value)).toBe("first");
  });

  it("records working copy repository access in WorkspaceObject", async () => {
    const { workspace, object } = createWorkspace({ repo: { "/note.txt": bytes("current") } });

    const copy = await workspace.copies.create({ label: "metadata" });
    if (Result.isError(copy)) throw new Error("copy failed");

    await expect(object.copy(copy.value.id)).resolves.toEqual({
      copyId: copy.value.id,
      label: "metadata",
      createdAt: copy.value.createdAt,
      baseRepository: "repo",
      remote: "https://git.example/repo.git",
      defaultBranch: "main",
      baseRevisionId: "revision-repo-0",
    });
  });

  it("records working copy metadata when Artifacts get omits default branch", async () => {
    const { workspace, artifacts, object } = createWorkspace({ repo: { "/note.txt": bytes("current") } });
    artifacts.get = async () => ({
      name: "repo",
      remote: "https://git.example/repo.git",
    });

    const copy = await workspace.copies.create({ label: "metadata" });
    if (Result.isError(copy)) throw new Error("copy failed");

    await expect(object.copy(copy.value.id)).resolves.toEqual({
      copyId: copy.value.id,
      label: "metadata",
      createdAt: copy.value.createdAt,
      baseRepository: "repo",
      remote: "https://git.example/repo.git",
      defaultBranch: "main",
      baseRevisionId: "revision-repo-0",
    });
  });

  it("attaches a working copy to a filesystem host and reconciles changed files", async () => {
    const { workspace } = createWorkspace({ repo: { "/photos/original.txt": bytes("original") } });
    const host = new FakeMountHost();
    const copy = await workspace.copies.create({ label: "edit-photo" });
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
    const copy = await workspace.copies.create({ label: "dynamic-worker" });
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
  return { workspace: Workspace.bind({ artifacts, objects: { getByName: () => object } }).get("repo"), artifacts, driver, object };
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

describe("Workspace bug check", () => {
  it("allows writing to working copy created from empty base repo after base repo gets commits", async () => {
    const { workspace } = createWorkspace({ repo: {} });

    // Create working copy from empty base repo
    const copy = await workspace.copies.create({ label: "test-copy" });
    if (Result.isError(copy)) throw new Error("copy failed");

    // Commit to base repo
    await workspace.files.write("/base.txt", bytes("1"));

    // Try to write to working copy
    const writeResult = await copy.value.files.write("/copy.txt", bytes("2"));
    expect(Result.isOk(writeResult)).toBe(true);
  });
});
