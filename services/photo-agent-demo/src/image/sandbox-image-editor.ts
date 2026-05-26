export type SandboxCommandEdit = {
  command: string;
  input: Uint8Array;
  inputFilename: string;
};

export type SandboxCommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export interface DemoImageEditor {
  runSandboxCommand(edit: SandboxCommandEdit): Promise<SandboxCommandResult>;
  readSandboxFile(filename: string): Promise<Uint8Array>;
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
  exec(command: string, options?: { cwd?: string }): Promise<ExecResult>;
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

  async runSandboxCommand(edit: SandboxCommandEdit): Promise<SandboxCommandResult> {
    await this.sandbox.mkdir(this.root, { recursive: true });

    await this.sandbox.writeFile(this.pathFor(edit.inputFilename), bytesToStream(edit.input));
    const result = await this.sandbox.exec(edit.command, { cwd: this.root });
    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
      throw new Error(`Sandbox command failed: ${detail}`);
    }

    return {
      command: edit.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async readSandboxFile(filename: string): Promise<Uint8Array> {
    return this.readBytes(this.pathFor(filename));
  }

  private pathFor(filename: string): string {
    if (filename.length === 0 || filename.includes("/") || filename.includes("\\")) {
      throw new Error("Sandbox filenames must be relative file names");
    }

    return `${this.root}/${filename}`;
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
