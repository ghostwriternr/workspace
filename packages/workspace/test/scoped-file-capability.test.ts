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
      workingCopy,
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    await expect(capability.readFile("/photos/current")).resolves.toEqual({ status: "ok", value: photoBytes });
  });

  it("returns RpcResult access errors for denied reads", async () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
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
      workingCopy: new FakeWorkingCopy({
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
      workingCopy,
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
    await expect(workingCopy.readFile("/notes/2026/edit-summary.md")).resolves.toEqual({ status: "ok", value: noteBytes });
  });

  it("denies writes outside scope", async () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
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
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
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
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
    });

    expect("readFile" in capability).toBe(true);
    expect(Object.values(capability).filter((value) => typeof value === "function")).toEqual([]);
  });

  it("normalizes paths and returns path errors for traversal", async () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({
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

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string; message?: string } };

type Entry =
  | { type: "directory" }
  | { type: "file"; contents: Uint8Array };

class FakeWorkingCopy {
  readonly operationLog: string[] = [];

  constructor(private readonly entries: Record<string, Entry>) {}

  async readFile(path: string): Promise<RpcResult<Uint8Array>> {
    const entry = this.entries[path];
    if (!entry) return { status: "error", error: { tag: "PathNotFoundError" } };
    if (entry.type === "directory") return { status: "error", error: { tag: "IsDirectoryError" } };
    return { status: "ok", value: entry.contents };
  }

  async writeFile(path: string, contents: Uint8Array): Promise<RpcResult> {
    const parent = parentPath(path);
    if (!this.entries[parent]) return { status: "error", error: { tag: "PathNotFoundError" } };
    this.operationLog.push(`write ${path}`);
    this.entries[path] = { type: "file", contents };
    return { status: "ok" };
  }

  async list(path: string): Promise<RpcResult<Array<{ name: string; path: string; type: "directory" | "file" }>>> {
    const entry = this.entries[path];
    if (!entry) return { status: "error", error: { tag: "PathNotFoundError" } };
    if (entry.type === "file") return { status: "error", error: { tag: "NotDirectoryError" } };

    const prefix = path === "/" ? "/" : `${path}/`;
    const value = Object.entries(this.entries)
      .filter(([childPath]) => childPath !== path && childPath.startsWith(prefix))
      .filter(([childPath]) => !childPath.slice(prefix.length).includes("/"))
      .map(([childPath, child]) => ({
        name: childPath.split("/").at(-1) ?? "",
        path: childPath,
        type: child.type,
      }));
    return { status: "ok", value };
  }

  async stat(path: string): Promise<
    RpcResult<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }>
  > {
    const entry = this.entries[path];
    if (!entry) return { status: "error", error: { tag: "PathNotFoundError" } };
    return {
      status: "ok",
      value: {
        path,
        type: entry.type,
        size: entry.type === "file" ? entry.contents.byteLength : null,
        createdAt: 1,
        updatedAt: 1,
      },
    };
  }

  async mkdir(path: string): Promise<RpcResult> {
    if (this.entries[path]) return { status: "error", error: { tag: "PathAlreadyExistsError" } };
    const parent = parentPath(path);
    if (!this.entries[parent]) return { status: "error", error: { tag: "PathNotFoundError" } };
    this.operationLog.push(`mkdir ${path}`);
    this.entries[path] = { type: "directory" };
    return { status: "ok" };
  }

  async delete(path: string): Promise<RpcResult> {
    delete this.entries[path];
    return { status: "ok" };
  }
}

function parentPath(path: string): string {
  if (path === "/") return "/";
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent || "/";
}
