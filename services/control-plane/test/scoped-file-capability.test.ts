import { describe, expect, it } from "vitest";

import {
  createWorkspaceFileCapability,
  ScopedWorkspaceAccessError,
  ScopedWorkspacePathError,
} from "../src/workspace/scoped-file-capability";

const photoBytes = new TextEncoder().encode("photo");
const noteBytes = new TextEncoder().encode("note");

describe("scoped Workspace file capability", () => {
  it("allows reads in permitted paths", async () => {
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
      delete: false,
    });

    await expect(capability.readFile("/photos/current")).resolves.toEqual(photoBytes);
  });

  it("denies reads outside scope", async () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
      delete: false,
    });

    await expect(capability.readFile("/secrets/key.txt")).rejects.toSatisfy(
      (error) =>
        ScopedWorkspaceAccessError.is(error) &&
        error.operation === "readFile" &&
        error.path === "/secrets/key.txt",
    );
  });

  it("allows writes in permitted paths and creates explicit parent directories", async () => {
    const workingCopy = new FakeWorkingCopy({ "/": { type: "directory" } });
    const capability = createWorkspaceFileCapability({
      workingCopy,
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
      delete: false,
    });

    await capability.writeFile("/notes/edit-summary.md", noteBytes);

    expect(workingCopy.operationLog).toEqual(["mkdir /notes", "write /notes/edit-summary.md"]);
    await expect(workingCopy.readFile("/notes/edit-summary.md")).resolves.toEqual({ status: "ok", value: noteBytes });
  });

  it("denies writes outside scope", async () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
      delete: false,
    });

    await expect(capability.writeFile("/photos/current", photoBytes)).rejects.toSatisfy(
      (error) =>
        ScopedWorkspaceAccessError.is(error) &&
        error.operation === "writeFile" &&
        error.path === "/photos/current",
    );
  });

  it("does not expose commit or discard authority", () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
      delete: false,
    });

    expect("commit" in capability).toBe(false);
    expect("discard" in capability).toBe(false);
    expect("beginSession" in capability).toBe(false);
    expect("getSession" in capability).toBe(false);
    expect("getRevision" in capability).toBe(false);
    expect("getByName" in capability).toBe(false);
  });

  it("exposes methods from a capability prototype for Worker Loader env binding transfer", () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({ "/": { type: "directory" } }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
      delete: false,
    });

    expect("readFile" in capability).toBe(true);
    expect(Object.values(capability).filter((value) => typeof value === "function")).toEqual([]);
  });

  it("normalizes paths and rejects traversal", async () => {
    const capability = createWorkspaceFileCapability({
      workingCopy: new FakeWorkingCopy({
        "/": { type: "directory" },
        "/photos": { type: "directory" },
        "/photos/current": { type: "file", contents: photoBytes },
      }),
      root: "/",
      read: ["/photos/**"],
      write: ["/notes/**"],
      delete: false,
    });

    await expect(capability.readFile("photos//current")).resolves.toEqual(photoBytes);
    await expect(capability.readFile("/photos/../secrets/key.txt")).rejects.toSatisfy(
      (error) => ScopedWorkspacePathError.is(error) && error.path === "/photos/../secrets/key.txt",
    );
  });
});

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string } };

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
    if (this.entries[path]) return { status: "ok" };
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
