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

    await workspace.writeFile("/hello.txt", bytes("hello"));

    await expect(workspace.readFile("/hello.txt")).resolves.toSatisfy(
      (contents: Uint8Array) => text(contents) === "hello",
    );
  });

  it("lists immediate directory entries", async () => {
    const workspace = new MemoryWorkspace();

    await workspace.writeFile("/src/index.ts", bytes("export {};"));
    await workspace.writeFile("/README.md", bytes("# Workspace"));

    await expect(workspace.list("/")).resolves.toEqual([
      { name: "README.md", path: "/README.md", type: "file" },
      { name: "src", path: "/src", type: "directory" },
    ]);
    await expect(workspace.list("/src")).resolves.toEqual([
      { name: "index.ts", path: "/src/index.ts", type: "file" },
    ]);
  });

  it("rejects paths that are not absolute workspace paths", async () => {
    const workspace = new MemoryWorkspace();

    await expect(workspace.writeFile("relative.txt", bytes("no"))).rejects.toThrow(
      "Workspace paths must be absolute",
    );
    await expect(workspace.writeFile("/../secret.txt", bytes("no"))).rejects.toThrow(
      "Workspace paths must not contain traversal segments",
    );
    await expect(workspace.writeFile("/src//index.ts", bytes("no"))).rejects.toThrow(
      "Workspace paths must not contain empty segments",
    );
  });

  it("distinguishes files and directories", async () => {
    const workspace = new MemoryWorkspace();

    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    await expect(workspace.readFile("/src")).rejects.toThrow("Path is a directory");
    await expect(workspace.list("/src/index.ts")).rejects.toThrow("Path is a file");
  });

  it("deletes files from the tree", async () => {
    const workspace = new MemoryWorkspace();

    await workspace.writeFile("/src/index.ts", bytes("export {};"));
    await workspace.delete("/src/index.ts");

    await expect(workspace.readFile("/src/index.ts")).rejects.toThrow("Path not found");
    await expect(workspace.list("/")).resolves.toEqual([]);
  });
});
