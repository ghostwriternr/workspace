import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import {
  attachWorkspaceMount,
  MountOperationError,
  UnsupportedMountEntryError,
  type WorkspaceMount,
} from "../src/workspace/working-copy-mount";

const originalBytes = new Uint8Array([1, 2, 3]);
const currentBytes = new Uint8Array([4, 5, 6]);
const editedBytes = new Uint8Array([7, 8, 9]);

const rootEntry = { name: "", path: "/", type: "directory" as const };

describe("Workspace working-copy mount", () => {
  it("attaches a Workspace tree to a host filesystem root", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/original.png": { type: "file", contents: originalBytes },
      "/photos/current": { type: "file", contents: currentBytes },
    });
    const host = new FakeMountHost();

    await attachOk({ workingCopy, host, root: "/workspace" });

    expect(host.directories).toEqual(["/workspace", "/workspace/photos"]);
    expect(host.files).toEqual({
      "/workspace/photos/original.png": originalBytes,
      "/workspace/photos/current": currentBytes,
    });
  });

  it("clears the host root before materializing the working copy", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/current": { type: "file", contents: currentBytes },
    });
    const host = new FakeMountHost();
    host.files["/workspace/stale.txt"] = new Uint8Array([99]);

    const mount = await attachOk({ workingCopy, host, root: "/workspace" });
    const result = await mount.flush();

    if (Result.isError(result)) {
      throw result.error;
    }
    expect(host.resetPaths).toEqual(["/workspace"]);
    expect(host.files["/workspace/stale.txt"]).toBeUndefined();
    expect(result.value.created).toEqual([]);
  });

  it("flushes created, modified, and deleted host files into the working copy", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/original.png": { type: "file", contents: originalBytes },
      "/photos/current": { type: "file", contents: currentBytes },
    });
    const host = new FakeMountHost();
    const mount = await attachOk({ workingCopy, host, root: "/workspace" });

    delete host.files["/workspace/photos/original.png"];
    host.files["/workspace/photos/current"] = editedBytes;
    host.files["/workspace/photos/contact-sheet.png"] = new Uint8Array([10, 11, 12]);

    const result = await mount.flush();

    if (Result.isError(result)) {
      throw result.error;
    }
    expect(result.value).toEqual({
      created: ["/photos/contact-sheet.png"],
      modified: ["/photos/current"],
      deleted: ["/photos/original.png"],
      unchanged: 1,
    });
    expect(workingCopy.files()).toEqual({
      "/photos/current": editedBytes,
      "/photos/contact-sheet.png": new Uint8Array([10, 11, 12]),
    });
  });

  it("creates explicit directories before flushing nested files", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/current": { type: "file", contents: currentBytes },
    });
    const host = new FakeMountHost();
    const mount = await attachOk({ workingCopy, host, root: "/workspace" });

    host.directories.push("/workspace/photos/exports");
    host.files["/workspace/photos/exports/square.png"] = editedBytes;

    const result = await mount.flush();

    if (Result.isError(result)) {
      throw result.error;
    }
    expect(workingCopy.mkdirCalls).toEqual(["/photos/exports"]);
    expect(workingCopy.files()["/photos/exports/square.png"]).toEqual(editedBytes);
  });

  it("deletes removed paths before writing replacements with the same path", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/current": { type: "file", contents: currentBytes },
    });
    const host = new FakeMountHost();
    const mount = await attachOk({ workingCopy, host, root: "/workspace" });

    delete host.files["/workspace/photos/current"];
    host.directories.push("/workspace/photos/current");
    host.files["/workspace/photos/current/edited.png"] = editedBytes;

    const result = await mount.flush();

    if (Result.isError(result)) {
      throw result.error;
    }
    expect(workingCopy.operationLog).toEqual([
      "delete /photos/current",
      "mkdir /photos/current",
      "write /photos/current/edited.png",
    ]);
    expect(workingCopy.files()).toEqual({
      "/photos/current/edited.png": editedBytes,
    });
  });

  it("supports mounting at the host filesystem root", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/current": { type: "file", contents: currentBytes },
    });
    const host = new FakeMountHost();
    const mount = await attachOk({ workingCopy, host, root: "/" });

    host.files["/photos/current"] = editedBytes;

    const result = await mount.flush();

    if (Result.isError(result)) {
      throw result.error;
    }
    expect(result.value.modified).toEqual(["/photos/current"]);
    expect(workingCopy.files()["/photos/current"]).toEqual(editedBytes);
  });

  it("returns a Result error when Workspace operations fail during attach", async () => {
    const workingCopy = new FakeWorkingCopy({});
    const host = new FakeMountHost();

    const result = await attachWorkspaceMount({ workingCopy, host, root: "/workspace" });

    if (!Result.isError(result)) {
      throw new Error("expected mount operation error");
    }
    expect(MountOperationError.is(result.error)).toBe(true);
    expect(result.error).toMatchObject({
      operation: "list /",
      errorTag: "PathNotFoundError",
    });
  });

  it("rejects unsupported host filesystem entries", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
    });
    const host = new FakeMountHost();
    const mount = await attachOk({ workingCopy, host, root: "/workspace" });

    host.otherEntries.push({ path: "/workspace/photos/link", type: "symlink" });

    const result = await mount.flush();

    if (!Result.isError(result)) {
      throw new Error("expected unsupported entry error");
    }
    expect(UnsupportedMountEntryError.is(result.error)).toBe(true);
    expect(result.error).toMatchObject({
      path: "/workspace/photos/link",
      entryType: "symlink",
    });
  });
});

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string } };

type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

type FakeEntry =
  | { type: "directory" }
  | { type: "file"; contents: Uint8Array };

async function attachOk(options: {
  workingCopy: FakeWorkingCopy;
  host: FakeMountHost;
  root: string;
}): Promise<WorkspaceMount> {
  const result = await attachWorkspaceMount(options);
  if (Result.isError(result)) {
    throw result.error;
  }
  return result.value;
}

class FakeWorkingCopy {
  readonly mkdirCalls: string[] = [];
  readonly operationLog: string[] = [];

  constructor(private readonly entries: Record<string, FakeEntry>) {}

  async list(path: string): Promise<RpcResult<WorkspaceEntry[]>> {
    const entry = this.entries[path];
    if (!entry) return { status: "error", error: { tag: "PathNotFoundError" } };
    if (entry.type === "file") return { status: "error", error: { tag: "NotDirectoryError" } };

    const prefix = path === "/" ? "/" : `${path}/`;
    const children = Object.entries(this.entries)
      .filter(([childPath]) => childPath !== path && childPath.startsWith(prefix))
      .filter(([childPath]) => !childPath.slice(prefix.length).includes("/"))
      .map(([childPath, child]) => ({
        name: childPath.split("/").at(-1) ?? "",
        path: childPath,
        type: child.type,
      }));

    return { status: "ok", value: path === "/" ? children.filter((child) => child.path !== rootEntry.path) : children };
  }

  async readFile(path: string): Promise<RpcResult<Uint8Array>> {
    const entry = this.entries[path];
    if (!entry) return { status: "error", error: { tag: "PathNotFoundError" } };
    if (entry.type === "directory") return { status: "error", error: { tag: "IsDirectoryError" } };
    return { status: "ok", value: entry.contents };
  }

  async mkdir(path: string): Promise<RpcResult> {
    this.mkdirCalls.push(path);
    this.operationLog.push(`mkdir ${path}`);
    this.entries[path] = { type: "directory" };
    return { status: "ok" };
  }

  async writeFile(path: string, contents: Uint8Array): Promise<RpcResult> {
    this.operationLog.push(`write ${path}`);
    this.entries[path] = { type: "file", contents };
    return { status: "ok" };
  }

  async delete(path: string): Promise<RpcResult> {
    this.operationLog.push(`delete ${path}`);
    delete this.entries[path];
    return { status: "ok" };
  }

  files(): Record<string, Uint8Array> {
    return Object.fromEntries(
      Object.entries(this.entries)
        .filter((entry): entry is [string, { type: "file"; contents: Uint8Array }] => entry[1].type === "file")
        .map(([path, entry]) => [path, entry.contents]),
    );
  }
}

class FakeMountHost {
  readonly directories: string[] = [];
  readonly files: Record<string, Uint8Array> = {};
  readonly otherEntries: Array<{ path: string; type: "symlink" | "other" }> = [];
  readonly resetPaths: string[] = [];

  async resetDirectory(path: string) {
    this.resetPaths.push(path);
    const prefix = path === "/" ? "/" : `${path}/`;
    for (const filePath of Object.keys(this.files)) {
      if (filePath === path || filePath.startsWith(prefix)) {
        delete this.files[filePath];
      }
    }
    for (let index = this.directories.length - 1; index >= 0; index -= 1) {
      const directoryPath = this.directories[index]!;
      if (directoryPath === path || directoryPath.startsWith(prefix)) {
        this.directories.splice(index, 1);
      }
    }
  }

  async mkdir(path: string, _options: { recursive: boolean }) {
    if (!this.directories.includes(path)) {
      this.directories.push(path);
    }
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.files[path] = contents;
  }

  async readFile(path: string) {
    const contents = this.files[path];
    if (!contents) throw new Error(`missing fake host file: ${path}`);
    return contents;
  }

  async listFiles(path: string) {
    const prefix = path === "/" ? "/" : `${path}/`;
    return [
      ...this.directories
        .filter((directoryPath) => directoryPath !== path && directoryPath.startsWith(prefix))
        .map((directoryPath) => ({ path: directoryPath, type: "directory" as const })),
      ...Object.keys(this.files)
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => ({ path: filePath, type: "file" as const })),
      ...this.otherEntries,
    ];
  }
}
