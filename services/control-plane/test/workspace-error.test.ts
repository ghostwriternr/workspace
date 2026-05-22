import { describe, expect, it } from "vitest";
import { MemoryWorkspace } from "../src/core/memory-workspace";
import { WorkspaceError } from "../src/core/workspace-error";

const textEncoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

describe("WorkspaceError", () => {
  it("classifies invalid paths", async () => {
    const workspace = new MemoryWorkspace();

    await expect(workspace.readFile("relative.txt")).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("classifies missing paths", async () => {
    const workspace = new MemoryWorkspace();

    await expect(workspace.readFile("/missing.txt")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("classifies file and directory type mismatches", async () => {
    const workspace = new MemoryWorkspace();
    await workspace.writeFile("/src/index.ts", bytes("export {};"));

    await expect(workspace.readFile("/src")).rejects.toMatchObject({
      code: "is_directory",
    });
    await expect(workspace.list("/src/index.ts")).rejects.toMatchObject({
      code: "not_directory",
    });
  });

  it("uses Error semantics for catch blocks", async () => {
    const workspace = new MemoryWorkspace();

    await workspace.readFile("relative.txt").catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(String(error)).toContain("Workspace paths must be absolute");
    });
  });
});
