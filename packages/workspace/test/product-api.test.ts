import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "../src";

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

function closeableSyncEntries(entries: Array<{ path: string; contents: Uint8Array }>) {
  let closed = false;
  const source = {
    *[Symbol.iterator]() {
      try {
        yield* entries;
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

describe("Workspace product API", () => {
  it("works with current files through Result values instead of RPC DTOs", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-current-files");

    const write = await workspace.files.write("/hello.txt", bytes("hello"));
    const read = await workspace.files.read("/hello.txt");

    expect(Result.isError(write)).toBe(false);
    expect(Result.isError(read)).toBe(false);
    if (Result.isOk(read)) {
      expect(text(read.value)).toBe("hello");
    }
  });

  it("writes async file trees into isolated copies before apply", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-copy");
    const copyResult = await workspace.files.copy("import-tree");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports/repo", asyncEntries([
      { path: "README.md", contents: bytes("# Draft") },
      { path: "src/index.ts", contents: bytes("export const draft = true;") },
    ]));
    const currentBeforeApply = await workspace.files.read("/imports/repo/README.md");
    const apply = await copyResult.value.apply();
    const currentAfterApply = await workspace.files.read("/imports/repo/README.md");

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isError(currentBeforeApply)).toBe(true);
    if (Result.isError(currentBeforeApply)) {
      expect(currentBeforeApply.error).toMatchObject({ tag: "PathNotFoundError" });
    }
    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(currentAfterApply)).toBe(true);
    if (Result.isOk(currentAfterApply)) {
      expect(text(currentAfterApply.value)).toBe("# Draft");
    }
  });

  it("writes file trees into the copy root", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-root");
    const copyResult = await workspace.files.copy("import-root");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/", [
      { path: "README.md", contents: bytes("# Root") },
      { path: "src/index.ts", contents: bytes("export {};") },
    ]);
    await copyResult.value.apply();
    const read = await workspace.files.read("/src/index.ts");

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) {
      expect(text(read.value)).toBe("export {};");
    }
  });

  it("overwrites existing files when writing file trees into copies", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-overwrite");

    await workspace.files.mkdir("/imports");
    await workspace.files.write("/imports/README.md", bytes("old"));
    const copyResult = await workspace.files.copy("overwrite-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports", [
      { path: "README.md", contents: bytes("new") },
    ]);
    await copyResult.value.apply();
    const read = await workspace.files.read("/imports/README.md");

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) {
      expect(text(read.value)).toBe("new");
    }
  });

  it("lets later entries overwrite earlier entries in the same writeTree batch", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-duplicate");
    const copyResult = await workspace.files.copy("duplicate-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports/repo", [
      { path: "README.md", contents: bytes("one") },
      { path: "README.md", contents: bytes("two") },
    ]);
    await copyResult.value.apply();
    const read = await workspace.files.read("/imports/repo/README.md");

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) {
      expect(text(read.value)).toBe("two");
    }
  });

  it("does not change current files when copy writeTree has an invalid relative path", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-invalid-path");
    const copyResult = await workspace.files.copy("invalid-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports/repo", [
      { path: "README.md", contents: bytes("# Repo") },
      { path: "../escape.txt", contents: bytes("no") },
    ]);
    const rootStat = await workspace.files.stat("/imports");

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "InvalidPathError", path: "../escape.txt" });
    }
    expect(Result.isError(rootStat)).toBe(true);
    if (Result.isError(rootStat)) {
      expect(rootStat.error).toMatchObject({ tag: "PathNotFoundError", path: "/imports" });
    }
  });

  it("does not change current files when copy writeTree parents cross a file", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-type-collision");

    await workspace.files.write("/imports", bytes("not a directory"));
    const copyResult = await workspace.files.copy("type-collision-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports/repo", [
      { path: "README.md", contents: bytes("# Repo") },
    ]);
    const existing = await workspace.files.read("/imports");
    const nested = await workspace.files.read("/imports/repo/README.md");

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "NotDirectoryError", path: "/imports" });
    }
    expect(Result.isOk(existing)).toBe(true);
    if (Result.isOk(existing)) {
      expect(text(existing.value)).toBe("not a directory");
    }
    expect(Result.isError(nested)).toBe(true);
    if (Result.isError(nested)) {
      expect(nested.error).toMatchObject({ tag: "PathNotFoundError", path: "/imports/repo/README.md" });
    }
  });

  it("does not change current files when copy writeTree targets an existing directory", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-directory-target");

    await workspace.files.mkdir("/imports");
    await workspace.files.mkdir("/imports/README.md");
    const copyResult = await workspace.files.copy("directory-target-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports", [
      { path: "README.md", contents: bytes("# Repo") },
    ]);
    const read = await workspace.files.read("/imports/README.md");

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "IsDirectoryError", path: "/imports/README.md" });
    }
    expect(Result.isError(read)).toBe(true);
    if (Result.isError(read)) {
      expect(read.error).toMatchObject({ tag: "IsDirectoryError", path: "/imports/README.md" });
    }
  });

  it("lets later chunks overwrite paths written by earlier chunks", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-cross-chunk-overwrite");
    const copyResult = await workspace.files.copy("cross-chunk-overwrite");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const entries = [
      { path: "dupe.txt", contents: bytes("first") },
      ...Array.from({ length: 100 }, (_, index) => ({ path: `filler-${index}.txt`, contents: bytes(String(index)) })),
      { path: "dupe.txt", contents: bytes("second") },
    ];
    const writeTree = await copyResult.value.files.writeTree("/imports", asyncEntries(entries));
    await copyResult.value.apply();
    const read = await workspace.files.read("/imports/dupe.txt");

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isOk(read)).toBe(true);
    if (Result.isOk(read)) {
      expect(text(read.value)).toBe("second");
    }
  });

  it("returns Result errors and closes the source when a source iterable fails", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-source-error");
    const copyResult = await workspace.files.copy("source-error-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }
    const source = closeableFailingAsyncEntries();

    const writeTree = await copyResult.value.files.writeTree("/imports", source);
    const discard = await copyResult.value.discard();
    const current = await workspace.files.read("/imports/before.txt");

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({ tag: "WorkspaceTreeSourceError" });
    }
    expect(source.closed).toBe(true);
    expect(Result.isOk(discard)).toBe(true);
    expect(Result.isError(current)).toBe(true);
    if (Result.isError(current)) {
      expect(current.error).toMatchObject({ tag: "PathNotFoundError", path: "/imports/before.txt" });
    }
  });

  it("splits writeTree batches by accumulated content size", async () => {
    const object = new FakeWorkspaceObject();
    const workspace = Workspace.get({ getByName: () => object }, "unit");
    const copyResult = await workspace.files.copy("large-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports", [
      { path: "one.bin", contents: new Uint8Array(12 * 1024 * 1024) },
      { path: "two.bin", contents: new Uint8Array(12 * 1024 * 1024) },
    ]);

    expect(Result.isOk(writeTree)).toBe(true);
    expect(object.sessionWriteTreeBatchSizes).toEqual([1, 1]);
  });

  it("returns Result errors when a single writeTree entry exceeds the batch byte limit", async () => {
    const object = new FakeWorkspaceObject();
    const workspace = Workspace.get({ getByName: () => object }, "unit");
    const copyResult = await workspace.files.copy("oversized-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports", [
      { path: "huge.bin", contents: new Uint8Array(17 * 1024 * 1024) },
    ]);

    expect(Result.isError(writeTree)).toBe(true);
    if (Result.isError(writeTree)) {
      expect(writeTree.error).toMatchObject({
        tag: "WorkspaceTreeEntryTooLargeError",
        path: "huge.bin",
      });
    }
    expect(object.sessionWriteTreeBatchSizes).toEqual([]);
  });

  it("closes sync iterators when writeTree stops after a batch error", async () => {
    const object = new FailingWriteTreeWorkspaceObject();
    const workspace = Workspace.get({ getByName: () => object }, "unit");
    const copyResult = await workspace.files.copy("closing-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }
    const source = closeableSyncEntries([
      { path: "one.txt", contents: bytes("one") },
      { path: "two.txt", contents: bytes("two") },
    ]);

    const writeTree = await copyResult.value.files.writeTree("/imports", source);

    expect(Result.isError(writeTree)).toBe(true);
    expect(source.closed).toBe(true);
  });

  it("detects stale applies after copy writeTree", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-write-tree-stale-apply");
    const copyResult = await workspace.files.copy("stale-import");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const writeTree = await copyResult.value.files.writeTree("/imports", [
      { path: "README.md", contents: bytes("# Repo") },
    ]);
    await workspace.files.write("/head-change.txt", bytes("changed"));
    const apply = await copyResult.value.apply();

    expect(Result.isOk(writeTree)).toBe(true);
    expect(Result.isError(apply)).toBe(true);
    if (Result.isError(apply)) {
      expect(apply.error).toMatchObject({ tag: "SessionConflictError" });
    }
  });

  it("applies isolated file copies to current files", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-apply");

    await workspace.files.write("/note.txt", bytes("current"));
    const copyResult = await workspace.files.copy("edit-note");

    expect(Result.isError(copyResult)).toBe(false);
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const copy = copyResult.value;
    await copy.files.write("/note.txt", bytes("draft"));

    const currentBeforeApply = await workspace.files.read("/note.txt");
    expect(Result.isOk(currentBeforeApply)).toBe(true);
    if (Result.isOk(currentBeforeApply)) {
      expect(text(currentBeforeApply.value)).toBe("current");
    }

    const apply = await copy.apply();
    expect(Result.isError(apply)).toBe(false);

    const currentAfterApply = await workspace.files.read("/note.txt");
    expect(Result.isOk(currentAfterApply)).toBe(true);
    if (Result.isOk(currentAfterApply)) {
      expect(text(currentAfterApply.value)).toBe("draft");
    }
  });

  it("discards file copies without changing current files", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-discard");

    await workspace.files.write("/note.txt", bytes("current"));
    const copyResult = await workspace.files.copy("discard-note");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    await copyResult.value.files.write("/note.txt", bytes("draft"));
    const discard = await copyResult.value.discard();
    expect(Result.isError(discard)).toBe(false);

    const current = await workspace.files.read("/note.txt");
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) {
      expect(text(current.value)).toBe("current");
    }
  });

  it("recovers durable file copies by id", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-recover");

    await workspace.files.write("/note.txt", bytes("current"));
    const copyResult = await workspace.files.copy("recover-note");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const recoveredResult = await workspace.files.getCopy(copyResult.value.id);
    expect(Result.isError(recoveredResult)).toBe(false);
    if (Result.isError(recoveredResult)) {
      throw new Error("recover failed");
    }

    await recoveredResult.value.files.write("/note.txt", bytes("recovered draft"));
    await recoveredResult.value.apply();

    const current = await workspace.files.read("/note.txt");
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) {
      expect(text(current.value)).toBe("recovered draft");
    }
  });

  it("attaches a file copy to a filesystem host and captures changed files", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-attach-capture");
    const host = new FakeAttachmentHost();

    await workspace.files.mkdir("/photos");
    await workspace.files.write("/photos/original.txt", bytes("original"));
    const copyResult = await workspace.files.copy("edit-photo");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const attachment = await copyResult.value.files.attach(host, "/workspace");
    expect(Result.isOk(attachment)).toBe(true);
    if (Result.isError(attachment)) {
      throw new Error("attach failed");
    }

    host.files["/workspace/photos/current.txt"] = bytes("edited");

    const capture = await attachment.value.capture();
    const apply = await copyResult.value.apply();
    const current = await workspace.files.read("/photos/current.txt");

    expect(attachment.value.path).toBe("/workspace");
    expect(Result.isOk(capture)).toBe(true);
    if (Result.isOk(capture)) {
      expect(capture.value.created).toContain("/photos/current.txt");
    }
    expect(Result.isOk(apply)).toBe(true);
    expect(Result.isOk(current)).toBe(true);
    if (Result.isOk(current)) {
      expect(text(current.value)).toBe("edited");
    }
  });

  it("returns Result errors for attachment materialization failures", async () => {
    const object = new BrokenAttachmentWorkspaceObject();
    const workspace = Workspace.get({ getByName: () => object }, "unit");
    const copyResult = await workspace.files.copy("unit-copy");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const attachment = await copyResult.value.files.attach(new FakeAttachmentHost(), "/workspace");

    expect(Result.isError(attachment)).toBe(true);
    if (Result.isError(attachment)) {
      expect(attachment.error).toMatchObject({
        operation: "list /",
        errorTag: "PathNotFoundError",
      });
    }
  });

  it("creates scoped file capabilities from file copies", async () => {
    const workspace = Workspace.get(env.WORKSPACES, "product-copy-scoped");

    await workspace.files.mkdir("/photos");
    await workspace.files.write("/photos/current", bytes("photo"));
    const copyResult = await workspace.files.copy("dynamic-worker");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    const capability = copyResult.value.files.scoped({
      read: "/photos/**",
      write: "/notes/**",
    });

    await expect(capability.readFile("/photos/current")).resolves.toEqual({
      status: "ok",
      value: bytes("photo"),
    });
    await expect(capability.writeFile("/notes/edit-summary.md", bytes("note"))).resolves.toEqual({ status: "ok" });
    await expect(capability.writeFile("/photos/current", bytes("updated"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "ScopedWorkspaceAccessError" },
    });

    const note = await copyResult.value.files.read("/notes/edit-summary.md");
    expect(Result.isOk(note)).toBe(true);
    if (Result.isOk(note)) {
      expect(text(note.value)).toBe("note");
    }
    expect("apply" in capability).toBe(false);
    expect("discard" in capability).toBe(false);
    expect("getByName" in capability).toBe(false);
  });

  it("uses session-id operations without looking up session stubs for file operations", async () => {
    const object = new FakeWorkspaceObject();
    const workspace = Workspace.get({ getByName: () => object }, "unit");

    const copyResult = await workspace.files.copy("unit-copy");
    if (Result.isError(copyResult)) {
      throw new Error("copy failed");
    }

    await copyResult.value.files.write("/note.txt", bytes("draft"));
    const read = await copyResult.value.files.read("/note.txt");
    await copyResult.value.apply();

    expect(object.getSessionCount).toBe(0);
    expect(object.sessionWriteCount).toBe(1);
    expect(object.sessionReadCount).toBe(1);
    expect(object.sessionCommitCount).toBe(1);
    if (Result.isOk(read)) {
      expect(text(read.value)).toBe("draft");
    }
  });
});

class FakeAttachmentHost {
  readonly directories = new Set<string>();
  readonly files: Record<string, Uint8Array> = {};

  async resetDirectory(path: string) {
    for (const filePath of Object.keys(this.files)) {
      if (filePath === path || filePath.startsWith(`${path}/`)) {
        delete this.files[filePath];
      }
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
    if (!content) throw new Error(`missing fake attachment file: ${path}`);
    return content;
  }

  async listTree(path: string) {
    const prefix = `${path}/`;
    return [
      ...[...this.directories]
        .filter((directoryPath) => directoryPath !== path && directoryPath.startsWith(prefix))
        .map((directoryPath) => ({
          path: directoryPath,
          type: "directory" as const,
        })),
      ...Object.keys(this.files)
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => ({
          path: filePath,
          type: "file" as const,
        })),
    ];
  }
}

class FakeWorkspaceObject {
  getSessionCount = 0;
  sessionWriteCount = 0;
  sessionReadCount = 0;
  sessionCommitCount = 0;
  readonly sessionWriteTreeBatchSizes: number[] = [];
  private readonly files = new Map<string, Uint8Array>();

  async beginSession() {
    return { status: "ok" as const, value: { sessionId: "copy-1", createdAt: 1 } };
  }

  async getSession(sessionId: string) {
    this.getSessionCount += 1;
    return { status: "ok" as const, value: { sessionId, createdAt: 1 } };
  }

  async mkdir(_path: string) {
    return { status: "ok" as const };
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.files.set(path, contents);
    return { status: "ok" as const };
  }

  async readFile(path: string) {
    const value = this.files.get(path);
    return value ? { status: "ok" as const, value } : { status: "error" as const, error: pathNotFound(path) };
  }

  async list(_path: string) {
    return { status: "ok" as const, value: [] };
  }

  async stat(path: string) {
    const value = this.files.get(path);
    return value
      ? { status: "ok" as const, value: { path, type: "file" as const, size: value.byteLength, createdAt: 1, updatedAt: 1 } }
      : { status: "error" as const, error: pathNotFound(path) };
  }

  async delete(path: string) {
    this.files.delete(path);
    return { status: "ok" as const };
  }

  async sessionMkdir(_sessionId: string, _path: string) {
    return { status: "ok" as const };
  }

  async sessionWriteFile(_sessionId: string, path: string, contents: Uint8Array) {
    this.sessionWriteCount += 1;
    this.files.set(path, contents);
    return { status: "ok" as const };
  }

  async sessionWriteTreeBatch(
    _sessionId: string,
    root: string,
    entries: Array<{ path: string; contents: Uint8Array }>,
  ): Promise<
    | { status: "ok" }
    | { status: "error"; error: { tag: "InvalidPathError"; path: string; reason: "empty_segment"; message: string } }
  > {
    this.sessionWriteTreeBatchSizes.push(entries.length);
    for (const entry of entries) {
      this.files.set(joinTreePath(root, entry.path), entry.contents);
    }
    return { status: "ok" as const };
  }

  async sessionReadFile(_sessionId: string, path: string) {
    this.sessionReadCount += 1;
    const value = this.files.get(path);
    return value ? { status: "ok" as const, value } : { status: "error" as const, error: pathNotFound(path) };
  }

  async sessionList(
    _sessionId: string,
    _path: string,
  ): Promise<
    | { status: "ok"; value: Array<{ name: string; path: string; type: "directory" | "file" }> }
    | { status: "error"; error: ReturnType<typeof pathNotFound> }
  > {
    return { status: "ok" as const, value: [] };
  }

  async sessionStat(_sessionId: string, path: string) {
    const value = this.files.get(path);
    return value
      ? { status: "ok" as const, value: { path, type: "file" as const, size: value.byteLength, createdAt: 1, updatedAt: 1 } }
      : { status: "error" as const, error: pathNotFound(path) };
  }

  async sessionDelete(_sessionId: string, path: string) {
    this.files.delete(path);
    return { status: "ok" as const };
  }

  async sessionCommit(_sessionId: string) {
    this.sessionCommitCount += 1;
    return { status: "ok" as const, value: { revisionId: "revision-1", createdAt: 2 } };
  }

  async sessionDiscard(_sessionId: string) {
    return { status: "ok" as const };
  }
}

class FailingWriteTreeWorkspaceObject extends FakeWorkspaceObject {
  async sessionWriteTreeBatch(_sessionId: string, _root: string, _entries: Array<{ path: string; contents: Uint8Array }>) {
    return { status: "error" as const, error: { tag: "InvalidPathError" as const, path: "bad", reason: "empty_segment" as const, message: "bad" } };
  }
}

class BrokenAttachmentWorkspaceObject extends FakeWorkspaceObject {
  async sessionList(_sessionId: string, path: string) {
    return { status: "error" as const, error: pathNotFound(path) };
  }
}

function joinTreePath(root: string, path: string): string {
  return root === "/" ? `/${path}` : `${root}/${path}`;
}

function pathNotFound(path: string) {
  return {
    tag: "PathNotFoundError" as const,
    path,
    message: `Path not found: ${path}`,
  };
}
