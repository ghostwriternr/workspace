import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { SandboxWorkspaceCommandRunner } from "../src/workspace/sandbox-workspace-command-runner";

const originalBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const editedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);

describe("SandboxWorkspaceCommandRunner", () => {
  it("attaches the Workspace draft at /workspace, runs the command, and flushes changes", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/original.png": { type: "file", contents: originalBytes },
      "/photos/current": { type: "file", contents: originalBytes },
    });
    const sandbox = new FakeSandbox({
      afterExec: (files) => {
        files["/workspace/photos/current"] = editedBytes;
      },
    });
    sandbox.files["/workspace/stale.txt"] = new Uint8Array([99]);
    const runner = new SandboxWorkspaceCommandRunner(sandbox);

    const result = await runner.runWorkspaceCommand({
      files: workingCopy,
      root: "/workspace",
      command: "convert /workspace/photos/original.png /workspace/photos/current",
      draftEditId: "draft-1",
    });

    expect(result).toEqual({
      command: "convert /workspace/photos/original.png /workspace/photos/current",
      root: "/workspace",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      flush: {
        created: [],
        modified: ["/photos/current"],
        deleted: [],
        unchanged: 2,
      },
    });
    expect(sandbox.commands).toEqual([
      {
        command: "rm -rf '/workspace' && mkdir -p '/workspace'",
        options: undefined,
      },
      {
        command: "convert /workspace/photos/original.png /workspace/photos/current",
        options: { cwd: "/workspace" },
      },
    ]);
    expect(sandbox.files["/workspace/photos/original.png"]).toEqual(originalBytes);
    expect(sandbox.files["/workspace/stale.txt"]).toBeUndefined();
    expect(workingCopy.files()["/photos/current"]).toEqual(editedBytes);
  });

  it("does not flush partial filesystem changes when the command fails", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/current": { type: "file", contents: originalBytes },
    });
    const sandbox = new FakeSandbox({
      execResult: { success: false, exitCode: 1, stdout: "", stderr: "bad image" },
      afterExec: (files) => {
        files["/workspace/photos/current"] = editedBytes;
      },
    });
    const runner = new SandboxWorkspaceCommandRunner(sandbox);

    await expect(
      runner.runWorkspaceCommand({
        files: workingCopy,
        root: "/workspace",
        command: "convert /workspace/photos/current /workspace/photos/current",
        draftEditId: "draft-1",
      }),
    ).rejects.toThrow("Sandbox command failed: bad image");

    expect(workingCopy.files()["/photos/current"]).toEqual(originalBytes);
  });
});

type FakeEntry =
  | { type: "directory" }
  | { type: "file"; contents: Uint8Array };

class FakeWorkingCopy {
  constructor(private readonly entries: Record<string, FakeEntry>) {}

  async list(path: string): Promise<Result<Array<{ name: string; path: string; type: "directory" | "file" }>, { tag: string }>> {
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

  async read(path: string): Promise<Result<Uint8Array, { tag: string }>> {
    const entry = this.entries[path];
    if (!entry) return Result.err({ tag: "PathNotFoundError" });
    if (entry.type === "directory") return Result.err({ tag: "IsDirectoryError" });
    return Result.ok(entry.contents);
  }

  async mkdir(path: string): Promise<Result<void, { tag: string }>> {
    this.entries[path] = { type: "directory" };
    return Result.ok();
  }

  async write(path: string, contents: Uint8Array): Promise<Result<void, { tag: string }>> {
    this.entries[path] = { type: "file", contents };
    return Result.ok();
  }

  async delete(path: string): Promise<Result<void, { tag: string }>> {
    delete this.entries[path];
    return Result.ok();
  }

  async stat(path: string): Promise<Result<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }, { tag: string }>> {
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

  files(): Record<string, Uint8Array> {
    return Object.fromEntries(
      Object.entries(this.entries)
        .filter((entry): entry is [string, { type: "file"; contents: Uint8Array }] => entry[1].type === "file")
        .map(([path, entry]) => [path, entry.contents]),
    );
  }
}

class FakeSandbox {
  readonly commands: Array<{ command: string; options: { cwd: string } | undefined }> = [];
  readonly directories = new Set<string>();
  readonly files: Record<string, Uint8Array> = {};

  private readonly execResult: { success: boolean; exitCode: number; stdout: string; stderr: string };
  private readonly afterExec?: (files: Record<string, Uint8Array>) => void;

  constructor(options: {
    execResult?: { success: boolean; exitCode: number; stdout: string; stderr: string };
    afterExec?: (files: Record<string, Uint8Array>) => void;
  }) {
    this.execResult = options.execResult ?? { success: true, exitCode: 0, stdout: "ok", stderr: "" };
    this.afterExec = options.afterExec;
  }

  async mkdir(path: string, _options: { recursive: boolean }) {
    this.directories.add(path);
  }

  async exec(command: string, options?: { cwd?: string }) {
    this.commands.push({ command, options: options?.cwd ? { cwd: options.cwd } : undefined });
    if (command === "rm -rf '/workspace' && mkdir -p '/workspace'") {
      for (const filePath of Object.keys(this.files)) {
        if (filePath === "/workspace" || filePath.startsWith("/workspace/")) {
          delete this.files[filePath];
        }
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    }
    this.afterExec?.(this.files);
    return this.execResult;
  }

  async writeFile(path: string, content: ReadableStream<Uint8Array>) {
    this.files[path] = await collect(content);
  }

  async readFile(path: string, _options: { encoding: "none" }) {
    const content = this.files[path];
    if (!content) throw new Error(`missing fake sandbox file: ${path}`);
    return {
      success: true as const,
      path,
      content: bytesToStream(content),
      size: content.byteLength,
      mimeType: "image/png",
      timestamp: new Date(0).toISOString(),
    };
  }

  async listFiles(path: string, _options?: { recursive?: boolean; includeHidden?: boolean }) {
    const prefix = `${path}/`;
    return {
      success: true,
      path,
      files: [
        ...[...this.directories]
          .filter((directoryPath) => directoryPath !== path && directoryPath.startsWith(prefix))
          .map((directoryPath) => ({
            name: directoryPath.split("/").at(-1) ?? "",
            absolutePath: directoryPath,
            relativePath: directoryPath.slice(prefix.length),
            type: "directory" as const,
            size: 0,
            modifiedAt: new Date(0).toISOString(),
            mode: "755",
            permissions: { readable: true, writable: true, executable: true },
          })),
        ...Object.keys(this.files)
          .filter((filePath) => filePath.startsWith(prefix))
          .map((filePath) => ({
            name: filePath.split("/").at(-1) ?? "",
            absolutePath: filePath,
            relativePath: filePath.slice(prefix.length),
            type: "file" as const,
            size: this.files[filePath]!.byteLength,
            modifiedAt: new Date(0).toISOString(),
            mode: "644",
            permissions: { readable: true, writable: true, executable: false },
          })),
      ],
      count: this.directories.size + Object.keys(this.files).length,
      timestamp: new Date(0).toISOString(),
    };
  }
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

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
