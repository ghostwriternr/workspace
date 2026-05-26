import { buildDemoImageCommand, buildGrayscaleCommand } from "./imagemagick";

export type DemoImageOperation = "grayscale";

export type DemoImageEdit = {
  operation: DemoImageOperation;
  contents: Uint8Array;
};

export interface DemoImageEditor {
  createOriginal(): Promise<Uint8Array>;
  makeDraftEdit(input: Uint8Array): Promise<DemoImageEdit>;
}

type ExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ReadFileStreamResult = {
  success: true;
  content: ReadableStream<Uint8Array>;
};

type SandboxClient = {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  exec(command: string): Promise<ExecResult>;
  writeFile(path: string, content: ReadableStream<Uint8Array>): Promise<unknown>;
  readFile(path: string, options: { encoding: "none" }): Promise<ReadFileStreamResult>;
};

export class SandboxImageEditor implements DemoImageEditor {
  private readonly root: string;

  constructor(
    private readonly sandbox: SandboxClient,
    workspaceName: string,
  ) {
    this.root = `/workspace/${workspaceName}`;
  }

  async createOriginal(): Promise<Uint8Array> {
    await this.sandbox.mkdir(this.root, { recursive: true });

    const outputPath = `${this.root}/original.png`;
    await this.execImageMagick(buildDemoImageCommand(outputPath));
    return this.readBytes(outputPath);
  }

  async makeDraftEdit(input: Uint8Array): Promise<DemoImageEdit> {
    await this.sandbox.mkdir(this.root, { recursive: true });

    const inputPath = `${this.root}/input.png`;
    const outputPath = `${this.root}/current.png`;

    await this.sandbox.writeFile(inputPath, bytesToStream(input));
    await this.execImageMagick(buildGrayscaleCommand(inputPath, outputPath));

    return {
      operation: "grayscale",
      contents: await this.readBytes(outputPath),
    };
  }

  private async execImageMagick(command: string): Promise<void> {
    const result = await this.sandbox.exec(command);
    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
      throw new Error(`ImageMagick command failed: ${detail}`);
    }
  }

  private async readBytes(path: string): Promise<Uint8Array> {
    const result = await this.sandbox.readFile(path, { encoding: "none" });
    return collectStream(result.content);
  }
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
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
