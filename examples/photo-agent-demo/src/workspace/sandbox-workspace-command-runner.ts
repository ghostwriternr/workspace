import { Result } from "better-result";
import type {
  WorkspaceFileAttachmentHost,
  WorkspaceFileCaptureSummary,
  WorkspaceFileCopyFiles,
} from "@cloudflare/workspace";

export type WorkspaceCommandResult = {
  command: string;
  root: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  capture: WorkspaceFileCaptureSummary;
};

export interface DemoWorkspaceCommandRunner {
  runWorkspaceCommand(options: {
    files: Pick<WorkspaceFileCopyFiles, "attach">;
    command: string;
    root: string;
    draftEditId: string;
  }): Promise<WorkspaceCommandResult>;
}

type ExecResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

type SandboxFileInfo = {
  absolutePath: string;
  type: "file" | "directory" | "symlink" | "other";
};

type SandboxListFilesResult =
  | { success: true; files: SandboxFileInfo[] }
  | { success: false; error?: string; files?: SandboxFileInfo[] };

type SandboxClient = {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  exec(command: string, options?: { cwd?: string }): Promise<ExecResult>;
  writeFile(path: string, content: ReadableStream<Uint8Array>): Promise<unknown>;
  readFile(path: string, options: { encoding: "none" }): Promise<{ success: true; content: ReadableStream<Uint8Array> }>;
  listFiles(path: string, options?: { recursive?: boolean; includeHidden?: boolean }): Promise<SandboxListFilesResult>;
};

// Sandbox owns execution. Workspace only supplies durable files and receives captured
// filesystem changes after successful execution.
type SandboxClientFactory = (draftEditId: string) => SandboxClient;

export class SandboxWorkspaceCommandRunner implements DemoWorkspaceCommandRunner {
  constructor(private readonly sandbox: SandboxClient | SandboxClientFactory) {}

  async runWorkspaceCommand(options: {
    files: Pick<WorkspaceFileCopyFiles, "attach">;
    command: string;
    root: string;
    draftEditId: string;
  }): Promise<WorkspaceCommandResult> {
    const sandbox = typeof this.sandbox === "function" ? this.sandbox(options.draftEditId) : this.sandbox;
    const attachment = await options.files.attach(sandboxAttachmentHost(sandbox), options.root);
    if (Result.isError(attachment)) {
      throw new Error(attachment.error.message);
    }

    const result = await sandbox.exec(options.command, { cwd: attachment.value.path });
    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
      throw new Error(`Sandbox command failed: ${detail}`);
    }

    const capture = await attachment.value.capture();
    if (Result.isError(capture)) {
      throw new Error(capture.error.message);
    }

    return {
      command: options.command,
      root: attachment.value.path,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      capture: capture.value,
    };
  }
}

function sandboxAttachmentHost(sandbox: SandboxClient): WorkspaceFileAttachmentHost {
  return {
    resetDirectory: async (path) => {
      await sandbox.exec(`rm -rf ${shellQuote(path)} && mkdir -p ${shellQuote(path)}`);
    },
    mkdir: async (path, options) => {
      await sandbox.mkdir(path, options);
    },
    writeFile: async (path, contents) => {
      await sandbox.writeFile(path, bytesToStream(contents));
    },
    readFile: async (path) => {
      const result = await sandbox.readFile(path, { encoding: "none" });
      return collectStream(result.content);
    },
    listTree: async (path) => {
      const result = await sandbox.listFiles(path, { recursive: true, includeHidden: true });
      if (!result.success) {
        throw new Error(result.error ?? `Sandbox listFiles failed for ${path}`);
      }

      return result.files.map((file) => ({
        path: file.absolutePath,
        type: file.type,
      }));
    },
  };
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
