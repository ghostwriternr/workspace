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

  async writeFile(path: string, content: ReadableStream<Uint8Array>) {
    this.files[path] = await collect(content);
  }

  async readFile(path: string, _options: { encoding: "none" }) {
    const content = this.files[path];
    if (!content) throw new Error(`missing fake attachment file: ${path}`);
    return { success: true as const, content: bytesToStream(content) };
  }

  async listFiles(path: string, _options: { recursive: boolean; includeHidden: boolean }) {
    const prefix = `${path}/`;
    return {
      success: true,
      files: [
        ...[...this.directories]
          .filter((directoryPath) => directoryPath !== path && directoryPath.startsWith(prefix))
          .map((directoryPath) => ({
            absolutePath: directoryPath,
            type: "directory" as const,
          })),
        ...Object.keys(this.files)
          .filter((filePath) => filePath.startsWith(prefix))
          .map((filePath) => ({
            absolutePath: filePath,
            type: "file" as const,
          })),
      ],
    };
  }
}

class FakeWorkspaceObject {
  getSessionCount = 0;
  sessionWriteCount = 0;
  sessionReadCount = 0;
  sessionCommitCount = 0;
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

class BrokenAttachmentWorkspaceObject extends FakeWorkspaceObject {
  async sessionList(_sessionId: string, path: string) {
    return { status: "error" as const, error: pathNotFound(path) };
  }
}

function bytesToStream(value: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    total += next.value.byteLength;
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function pathNotFound(path: string) {
  return {
    tag: "PathNotFoundError" as const,
    path,
    message: `Path not found: ${path}`,
  };
}
