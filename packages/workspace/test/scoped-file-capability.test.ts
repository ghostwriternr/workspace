import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { createWorkspaceFileCapability } from "../src/workspace/projections/scoped-file-capability";

const photoBytes = new TextEncoder().encode("photo");
const noteBytes = new TextEncoder().encode("note");

describe("scoped Workspace file capability", () => {
  it("returns RpcResult values for allowed reads", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/current": { type: "file", contents: photoBytes },
    });
    const capability = createWorkspaceFileCapability({
      files: workingCopy,
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    await expect(capability.readFile("/photos/current")).resolves.toEqual({ status: "ok", value: photoBytes });
  });

  it("returns RpcResult access errors for denied reads", async () => {
    const capability = createWorkspaceFileCapability({
      files: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    await expect(capability.readFile("/secrets/key.txt")).resolves.toEqual({
      status: "error",
      error: {
        tag: "ScopedWorkspaceAccessError",
        operation: "readFile",
        path: "/secrets/key.txt",
        message: "Workspace capability does not allow readFile at /secrets/key.txt",
      },
    });
  });

  it("allows root recursive scopes to match descendants", async () => {
    const capability = createWorkspaceFileCapability({
      files: new FakeWorkingCopy({
        "/": { type: "directory" },
        "/photos": { type: "directory" },
        "/photos/current": { type: "file", contents: photoBytes },
      }),
      root: "/",
      read: ["/**"],
      write: [],
    });

    await expect(capability.readFile("/photos/current")).resolves.toEqual({ status: "ok", value: photoBytes });
  });

  it("allows narrow write scopes and creates structural parent directories", async () => {
    const workingCopy = new FakeWorkingCopy({ "/": { type: "directory" } });
    const capability = createWorkspaceFileCapability({
      files: workingCopy,
      root: "/",
      read: [],
      write: ["/notes/2026/**"],
    });

    await expect(capability.writeFile("/notes/2026/edit-summary.md", noteBytes)).resolves.toEqual({ status: "ok" });

    expect(workingCopy.operationLog).toEqual([
      "mkdir /notes",
      "mkdir /notes/2026",
      "write /notes/2026/edit-summary.md",
    ]);
    await expect(workingCopy.read("/notes/2026/edit-summary.md")).resolves.toEqual({ status: "ok", value: noteBytes });
  });

  it("denies writes outside scope", async () => {
    const capability = createWorkspaceFileCapability({
      files: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    await expect(capability.writeFile("/photos/current", photoBytes)).resolves.toEqual({
      status: "error",
      error: {
        tag: "ScopedWorkspaceAccessError",
        operation: "writeFile",
        path: "/photos/current",
        message: "Workspace capability does not allow writeFile at /photos/current",
      },
    });
  });

  it("does not expose identity, publish, or delete authority", () => {
    const capability = createWorkspaceFileCapability({
      files: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    expect("commit" in capability).toBe(false);
    expect("discard" in capability).toBe(false);
    expect("beginSession" in capability).toBe(false);
    expect("getSession" in capability).toBe(false);
    expect("getRevision" in capability).toBe(false);
    expect("getByName" in capability).toBe(false);
    expect("delete" in capability).toBe(false);
  });

  it("exposes methods from a capability prototype for Worker Loader prop transfer", () => {
    const capability = createWorkspaceFileCapability({
      files: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    expect("readFile" in capability).toBe(true);
    expect(Object.values(capability).filter((value) => typeof value === "function")).toEqual([]);
  });

  it("normalizes paths and returns path errors for traversal", async () => {
    const capability = createWorkspaceFileCapability({
      files: new FakeWorkingCopy({
        "/": { type: "directory" },
        "/photos": { type: "directory" },
        "/photos/current": { type: "file", contents: photoBytes },
      }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    await expect(capability.readFile("photos//current")).resolves.toEqual({ status: "ok", value: photoBytes });
    await expect(capability.readFile("/photos/../secrets/key.txt")).resolves.toEqual({
      status: "error",
      error: {
        tag: "ScopedWorkspacePathError",
        path: "/photos/../secrets/key.txt",
        message: "Workspace capability path is not allowed: /photos/../secrets/key.txt",
      },
    });
  });
});

type Entry =
  | { type: "directory" }
  | { type: "file"; contents: Uint8Array };

class FakeWorkingCopy {
  readonly operationLog: string[] = [];

  constructor(private readonly entries: Record<string, Entry>) {}

  async read(path: string): Promise<Result<Uint8Array, { tag: string; message?: string }>> {
    const entry = this.entries[path];
    if (!entry) return Result.err({ tag: "PathNotFoundError" });
    if (entry.type === "directory") return Result.err({ tag: "IsDirectoryError" });
    return Result.ok(entry.contents);
  }

  async write(path: string, contents: Uint8Array): Promise<Result<void, { tag: string; message?: string }>> {
    const parent = parentPath(path);
    if (!this.entries[parent]) return Result.err({ tag: "PathNotFoundError" });
    this.operationLog.push(`write ${path}`);
    this.entries[path] = { type: "file", contents };
    return Result.ok();
  }

  async list(path: string): Promise<Result<Array<{ name: string; path: string; type: "directory" | "file" }>, { tag: string; message?: string }>> {
    const entry = this.entries[path];
    if (!entry) return Result.err({ tag: "PathNotFoundError" });
    if (entry.type === "file") return Result.err({ tag: "NotDirectoryError" });

    const prefix = path === "/" ? "/" : `${path}/`;
    const value = Object.entries(this.entries)
      .filter(([childPath]) => childPath !== path && childPath.startsWith(prefix))
      .filter(([childPath]) => !childPath.slice(prefix.length).includes("/"))
      .map(([childPath, child]) => ({
        name: childPath.split("/").at(-1) ?? "",
        path: childPath,
        type: child.type,
      }));
    return Result.ok(value);
  }

  async stat(path: string): Promise<
    Result<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }, { tag: string; message?: string }>
  > {
    const entry = this.entries[path];
    if (!entry) return Result.err({ tag: "PathNotFoundError" });
    return Result.ok({
        path,
        type: entry.type,
        size: entry.type === "file" ? entry.contents.byteLength : null,
        createdAt: 1,
        updatedAt: 1,
    });
  }

  async mkdir(path: string): Promise<Result<void, { tag: string; message?: string }>> {
    if (this.entries[path]) return Result.err({ tag: "PathAlreadyExistsError" });
    const parent = parentPath(path);
    if (!this.entries[parent]) return Result.err({ tag: "PathNotFoundError" });
    this.operationLog.push(`mkdir ${path}`);
    this.entries[path] = { type: "directory" };
    return Result.ok();
  }

  async delete(path: string): Promise<Result<void, { tag: string; message?: string }>> {
    delete this.entries[path];
    return Result.ok();
  }
}

function parentPath(path: string): string {
  if (path === "/") return "/";
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent || "/";
}
