import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { MemoryWorkspace } from "../src/core/memory-workspace";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function text(value: Uint8Array): string {
  return textDecoder.decode(value);
}

describe("MemoryWorkspace", () => {
  it("writes and reads file contents", async () => {
    const workspace = new MemoryWorkspace();

    const write = await workspace.writeFile("/hello.txt", bytes("hello"));
    const read = await workspace.readFile("/hello.txt");

    expect(write.status).toBe("ok");
    expect(read.match({ ok: text, err: (error) => error.message })).toBe("hello");
  });

  it("lists immediate directory entries", async () => {
    const workspace = new MemoryWorkspace();

    await workspace.writeFile("/src/index.ts", bytes("export {};"));
    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.list("/")).resolves.toMatchObject({
      status: "ok",
      value: [
        { name: "README.md", path: "/README.md", type: "file" },
        { name: "src", path: "/src", type: "directory" },
      ],
    });
    await expect(workspace.list("/src")).resolves.toMatchObject({
      status: "ok",
      value: [{ name: "index.ts", path: "/src/index.ts", type: "file" }],
    });
  });

  it("returns typed errors for paths that are not absolute workspace paths", async () => {
    const workspace = new MemoryWorkspace();

    await expect(workspace.writeFile("relative.txt", bytes("no"))).resolves.toMatchObject({
      status: "error",
      error: { _tag: "InvalidPathError", reason: "must_be_absolute" },
    });
    await expect(workspace.writeFile("/../secret.txt", bytes("no"))).resolves.toMatchObject({
      status: "error",
      error: { _tag: "InvalidPathError", reason: "traversal_segment" },
    });
    await expect(workspace.writeFile("/src//index.ts", bytes("no"))).resolves.toMatchObject({
      status: "error",
      error: { _tag: "InvalidPathError", reason: "empty_segment" },
    });
  });

  it("distinguishes files and directories", async () => {
    const workspace = new MemoryWorkspace();

    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    await expect(workspace.readFile("/src")).resolves.toMatchObject({
      status: "error",
      error: { _tag: "IsDirectoryError", path: "/src" },
    });
    await expect(workspace.list("/src/index.ts")).resolves.toMatchObject({
      status: "error",
      error: { _tag: "NotDirectoryError", path: "/src/index.ts" },
    });
  });

  it("deletes files from the tree", async () => {
    const workspace = new MemoryWorkspace();

    await workspace.writeFile("/src/index.ts", bytes("export {};"));
    const deletion = await workspace.delete("/src/index.ts");
    const read = await workspace.readFile("/src/index.ts");
    const rootList = await workspace.list("/");

    expect(deletion.status).toBe("ok");
    expect(read).toMatchObject({
      status: "error",
      error: { _tag: "PathNotFoundError", path: "/src/index.ts" },
    });
    expect(rootList).toMatchObject({ status: "ok", value: [] });
  });

  it("returns defensive copies of file contents", async () => {
    const workspace = new MemoryWorkspace();
    const original = bytes("hello");

    await workspace.writeFile("/hello.txt", original);
    original[0] = "j".charCodeAt(0);
    const firstRead = await workspace.readFile("/hello.txt");

    expect(firstRead.match({ ok: text, err: (error) => error.message })).toBe("hello");
    if (Result.isOk(firstRead)) {
      firstRead.value[0] = "y".charCodeAt(0);
    }

    const secondRead = await workspace.readFile("/hello.txt");
    expect(secondRead.match({ ok: text, err: (error) => error.message })).toBe("hello");
  });
});
