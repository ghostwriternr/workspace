import { describe, expect, it } from "vitest";

import { SandboxImageEditor } from "../src/image/sandbox-image-editor";

const inputBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const editedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

describe("SandboxImageEditor", () => {
  it("hydrates input bytes and runs a freeform command in the sandbox workspace", async () => {
    const sandbox = new FakeSandbox({});
    const editor = new SandboxImageEditor(sandbox, "photo-demo");

    const result = await editor.runSandboxCommand({
      input: inputBytes,
      inputFilename: "original.png",
      command: "identify original.png && convert original.png -colorspace Gray square.png",
    });

    expect(result).toEqual({
      command: "identify original.png && convert original.png -colorspace Gray square.png",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    expect(sandbox.writes["/workspace/photo-demo/original.png"]).toEqual(inputBytes);
    expect(sandbox.commands).toEqual([
      {
        command: "identify original.png && convert original.png -colorspace Gray square.png",
        options: { cwd: "/workspace/photo-demo" },
      },
    ]);
  });

  it("reads any sandbox file the agent chooses to import", async () => {
    const sandbox = new FakeSandbox({
      "/workspace/photo-demo/square.png": editedBytes,
    });
    const editor = new SandboxImageEditor(sandbox, "photo-demo");

    await expect(editor.readSandboxFile("square.png")).resolves.toEqual(editedBytes);
  });

  it("throws when a sandbox command exits unsuccessfully", async () => {
    const sandbox = new FakeSandbox({}, { success: false, exitCode: 1, stdout: "", stderr: "bad image" });
    const editor = new SandboxImageEditor(sandbox, "photo-demo");

    await expect(
      editor.runSandboxCommand({
        input: inputBytes,
        inputFilename: "original.png",
        command: "convert original.png square.png",
      }),
    ).rejects.toThrow("Sandbox command failed: bad image");
  });
});

class FakeSandbox {
  readonly commands: Array<{ command: string; options: { cwd: string } | undefined }> = [];
  readonly writes: Record<string, Uint8Array> = {};

  constructor(
    private readonly reads: Record<string, Uint8Array>,
    private readonly execResult = { success: true, exitCode: 0, stdout: "ok", stderr: "" },
  ) {}

  async mkdir(_path: string, _options: { recursive: boolean }) {}

  async exec(command: string, options?: { cwd?: string }) {
    this.commands.push({ command, options: options?.cwd ? { cwd: options.cwd } : undefined });
    return {
      ...this.execResult,
      command,
      duration: 1,
      timestamp: new Date(0).toISOString(),
    };
  }

  async writeFile(path: string, content: ReadableStream<Uint8Array>) {
    this.writes[path] = await collect(content);
    return { success: true, path, timestamp: new Date(0).toISOString() };
  }

  async readFile(path: string, _options: { encoding: "none" }) {
    const bytes = this.reads[path];
    if (!bytes) {
      throw new Error(`missing fake sandbox file: ${path}`);
    }

    return {
      success: true as const,
      path,
      content: bytesToStream(bytes),
      size: bytes.byteLength,
      mimeType: "image/png",
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
    if (next.done) {
      break;
    }
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
