import { describe, expect, it } from "vitest";

import { SandboxImageEditor } from "../src/image/sandbox-image-editor";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const grayscaleBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

describe("SandboxImageEditor", () => {
  it("generates an original PNG with ImageMagick", async () => {
    const sandbox = new FakeSandbox({
      "/workspace/photo-demo/original.png": pngBytes,
    });
    const editor = new SandboxImageEditor(sandbox, "photo-demo");

    const original = await editor.createOriginal();

    expect(original).toEqual(pngBytes);
    expect(sandbox.commands).toEqual([
      "convert -size '96x64' 'gradient:#5b8cff-#111827' '/workspace/photo-demo/original.png'",
    ]);
  });

  it("hydrates input bytes and produces a grayscale draft", async () => {
    const sandbox = new FakeSandbox({
      "/workspace/photo-demo/current.png": grayscaleBytes,
    });
    const editor = new SandboxImageEditor(sandbox, "photo-demo");

    const result = await editor.makeDraftEdit(pngBytes);

    expect(result).toEqual({ operation: "grayscale", contents: grayscaleBytes });
    expect(sandbox.writes["/workspace/photo-demo/input.png"]).toEqual(pngBytes);
    expect(sandbox.commands).toEqual([
      "convert '/workspace/photo-demo/input.png' -colorspace Gray '/workspace/photo-demo/current.png'",
    ]);
  });

  it("throws when ImageMagick exits unsuccessfully", async () => {
    const sandbox = new FakeSandbox({}, { success: false, exitCode: 1, stderr: "bad image" });
    const editor = new SandboxImageEditor(sandbox, "photo-demo");

    await expect(editor.createOriginal()).rejects.toThrow("ImageMagick command failed: bad image");
  });
});

class FakeSandbox {
  readonly commands: string[] = [];
  readonly writes: Record<string, Uint8Array> = {};

  constructor(
    private readonly reads: Record<string, Uint8Array>,
    private readonly execResult = { success: true, exitCode: 0, stderr: "" },
  ) {}

  async mkdir(_path: string, _options: { recursive: boolean }) {}

  async exec(command: string) {
    this.commands.push(command);
    return {
      ...this.execResult,
      stdout: "",
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
