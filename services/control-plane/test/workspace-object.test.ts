import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function text(value: Uint8Array): string {
  return textDecoder.decode(value);
}

describe("WorkspaceObject", () => {
  it("persists file bytes through Durable Object metadata and R2 blobs", async () => {
    const workspace = env.WORKSPACES.getByName("write-read");

    const write = await workspace.writeFile("/hello.txt", bytes("hello"));
    const read = await workspace.readFile("/hello.txt");

    expect(write).toEqual({ status: "ok" });
    expect(read.status).toBe("ok");
    if (read.status === "ok") {
      expect(text(read.value)).toBe("hello");
    }
  });

  it("creates explicit directories that can be listed and statted", async () => {
    const workspace = env.WORKSPACES.getByName("explicit-directories");

    await expect(workspace.mkdir("/src")).resolves.toEqual({ status: "ok" });
    await expect(workspace.list("/")).resolves.toEqual({
      status: "ok",
      value: [{ name: "src", path: "/src", type: "directory" }],
    });
    await expect(workspace.stat("/src")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/src",
        type: "directory",
        size: null,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    });
  });

  it("requires parent directories to exist before writing nested files", async () => {
    const workspace = env.WORKSPACES.getByName("parent-required");

    await expect(workspace.writeFile("/src/index.ts", bytes("export {};"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });

    await workspace.mkdir("/src");
    await expect(workspace.writeFile("/src/index.ts", bytes("export {};"))).resolves.toEqual({
      status: "ok",
    });
  });

  it("lists immediate children from Durable Object metadata", async () => {
    const workspace = env.WORKSPACES.getByName("list-children");

    await workspace.mkdir("/src");
    await workspace.writeFile("/src/index.ts", bytes("export {};"));
    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.list("/")).resolves.toEqual({
      status: "ok",
      value: [
        { name: "README.md", path: "/README.md", type: "file" },
        { name: "src", path: "/src", type: "directory" },
      ],
    });
    await expect(workspace.list("/src")).resolves.toEqual({
      status: "ok",
      value: [{ name: "index.ts", path: "/src/index.ts", type: "file" }],
    });
  });

  it("stats files with durable metadata", async () => {
    const workspace = env.WORKSPACES.getByName("stat-file");

    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.stat("/README.md")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/README.md",
        type: "file",
        size: 11,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    });
  });

  it("deletes files without pruning explicit parent directories", async () => {
    const workspace = env.WORKSPACES.getByName("delete-file");

    await workspace.mkdir("/src");
    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    await expect(workspace.delete("/src/index.ts")).resolves.toEqual({ status: "ok" });
    await expect(workspace.readFile("/src/index.ts")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src/index.ts" },
    });
    await expect(workspace.list("/")).resolves.toEqual({
      status: "ok",
      value: [{ name: "src", path: "/src", type: "directory" }],
    });
  });

  it("deletes empty directories and rejects non-empty directory deletes", async () => {
    const workspace = env.WORKSPACES.getByName("delete-directories");

    await workspace.mkdir("/src");
    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    await expect(workspace.delete("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "DirectoryNotEmptyError", path: "/src" },
    });

    await workspace.delete("/src/index.ts");
    await expect(workspace.delete("/src")).resolves.toEqual({ status: "ok" });
    await expect(workspace.stat("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/src" },
    });
  });

  it("returns serializable errors for invalid workspace paths", async () => {
    const workspace = env.WORKSPACES.getByName("invalid-paths");

    await expect(workspace.writeFile("relative.txt", bytes("no"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "InvalidPathError", path: "relative.txt", reason: "must_be_absolute" },
    });
    await expect(workspace.mkdir("/src//nested")).resolves.toMatchObject({
      status: "error",
      error: { tag: "InvalidPathError", path: "/src//nested", reason: "empty_segment" },
    });
    await expect(workspace.stat("/../secret.txt")).resolves.toMatchObject({
      status: "error",
      error: { tag: "InvalidPathError", path: "/../secret.txt", reason: "traversal_segment" },
    });
  });

  it("does not allow file paths to act as directories", async () => {
    const workspace = env.WORKSPACES.getByName("file-directory-mismatch");

    await workspace.writeFile("/src", bytes("not a directory"));

    await expect(workspace.mkdir("/src/nested")).resolves.toMatchObject({
      status: "error",
      error: { tag: "NotDirectoryError", path: "/src" },
    });
    await expect(workspace.writeFile("/src/index.ts", bytes("export {};"))).resolves.toMatchObject({
      status: "error",
      error: { tag: "NotDirectoryError", path: "/src" },
    });
    await expect(workspace.list("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "NotDirectoryError", path: "/src" },
    });
  });

  it("does not let mkdir replace existing entries", async () => {
    const workspace = env.WORKSPACES.getByName("mkdir-existing-entry");

    await workspace.mkdir("/src");
    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.mkdir("/src")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathAlreadyExistsError", path: "/src" },
    });
    await expect(workspace.mkdir("/README.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathAlreadyExistsError", path: "/README.md" },
    });
  });
});
