import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

const getSandbox = vi.fn((_sandboxes: unknown, id: string, options: unknown) => new FakeSandbox(id, options));

vi.mock("@cloudflare/sandbox", () => ({ getSandbox }));

const { createSandboxWorkspaceCommandRunner } = await import("../src/workspace/cloudflare-sandbox");

const originalBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const editedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]);

describe("createSandboxWorkspaceCommandRunner", () => {
  it("uses a short-lived sandbox scoped to the draft edit", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/current": { type: "file", contents: originalBytes },
    });
    const runner = createSandboxWorkspaceCommandRunner({} as never, "manual-demo");

    await runner.runWorkspaceCommand({
      files: workingCopy,
      command: "convert /workspace/photos/current /workspace/photos/current",
      root: "/workspace",
      draftEditId: "draft-123",
    });

    expect(getSandbox).toHaveBeenCalledWith({}, "manual-demo-draft-123", { sleepAfter: "60s" });
    expect(workingCopy.files()["/photos/current"]).toEqual(editedBytes);
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
  readonly directories = new Set<string>();
  readonly files: Record<string, Uint8Array> = {};

  constructor(
    readonly id: string,
    readonly options: unknown,
  ) {}

  async mkdir(path: string, _options: { recursive: boolean }) {
    this.directories.add(path);
  }

  async exec(command: string, _options?: { cwd?: string }) {
    if (command === "rm -rf '/workspace' && mkdir -p '/workspace'") {
      for (const filePath of Object.keys(this.files)) {
        if (filePath === "/workspace" || filePath.startsWith("/workspace/")) {
          delete this.files[filePath];
        }
      }
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    }

    this.files["/workspace/photos/current"] = editedBytes;
    return { success: true, exitCode: 0, stdout: "ok", stderr: "" };
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
