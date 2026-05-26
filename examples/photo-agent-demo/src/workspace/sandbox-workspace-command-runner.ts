import { Result } from "better-result";

// This example uses the low-level projection helper directly until the product-facing
// Workspace API grows file copies, attachments, and capture semantics.
import {
  attachWorkspaceMount,
  type WorkspaceMountFlushSummary,
  type WorkspaceMountHost,
  type WorkspaceMountWorkingCopy,
} from "../../../../packages/workspace/src/workspace/projections/working-copy-mount";

export type WorkspaceCommandResult = {
  command: string;
  root: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  flush: WorkspaceMountFlushSummary;
};

export interface DemoWorkspaceCommandRunner {
  runWorkspaceCommand(options: {
    workingCopy: WorkspaceMountWorkingCopy;
    command: string;
    root: string;
  }): Promise<WorkspaceCommandResult>;
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

type SandboxFileInfo = {
  absolutePath: string;
  type: "file" | "directory" | "symlink" | "other";
};

type SandboxClient = {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  exec(command: string, options?: { cwd?: string }): Promise<ExecResult>;
  writeFile(path: string, content: ReadableStream<Uint8Array>): Promise<unknown>;
  readFile(path: string, options: { encoding: "none" }): Promise<ReadFileStreamResult>;
  listFiles(path: string, options?: { recursive?: boolean; includeHidden?: boolean }): Promise<{
    success: boolean;
    files: SandboxFileInfo[];
  }>;
};

// Sandbox owns execution. Workspace only supplies durable files and receives captured
// filesystem changes after successful execution.
export class SandboxWorkspaceCommandRunner implements DemoWorkspaceCommandRunner {
  constructor(private readonly sandbox: SandboxClient) {}

  async runWorkspaceCommand(options: {
    workingCopy: WorkspaceMountWorkingCopy;
    command: string;
    root: string;
  }): Promise<WorkspaceCommandResult> {
    const host = new SandboxWorkspaceMountHost(this.sandbox);
    const mount = await attachWorkspaceMount({
      workingCopy: options.workingCopy,
      host,
      root: options.root,
    });

    if (Result.isError(mount)) {
      throw new Error(mount.error.message);
    }

    const result = await this.sandbox.exec(options.command, { cwd: mount.value.root });
    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
      throw new Error(`Sandbox command failed: ${detail}`);
    }

    const flush = await mount.value.flush();
    if (Result.isError(flush)) {
      throw new Error(flush.error.message);
    }

    return {
      command: options.command,
      root: mount.value.root,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      flush: flush.value,
    };
  }
}

class SandboxWorkspaceMountHost implements WorkspaceMountHost {
  constructor(private readonly sandbox: SandboxClient) {}

  async resetDirectory(path: string): Promise<void> {
    await this.sandbox.exec(`rm -rf ${shellQuote(path)} && mkdir -p ${shellQuote(path)}`);
  }

  async mkdir(path: string, options: { recursive: boolean }): Promise<void> {
    await this.sandbox.mkdir(path, options);
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    await this.sandbox.writeFile(path, bytesToStream(contents));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const result = await this.sandbox.readFile(path, { encoding: "none" });
    return collectStream(result.content);
  }

  async listFiles(path: string) {
    const result = await this.sandbox.listFiles(path, { recursive: true, includeHidden: true });
    return result.files.map((file) => ({
      path: file.absolutePath,
      type: file.type,
    }));
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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
