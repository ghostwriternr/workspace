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
  flush: WorkspaceFileCaptureSummary;
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
      flush: capture.value,
    };
  }
}

function sandboxAttachmentHost(sandbox: SandboxClient): WorkspaceFileAttachmentHost {
  return {
    resetDirectory: async (path) => {
      await sandbox.exec(`rm -rf ${shellQuote(path)} && mkdir -p ${shellQuote(path)}`);
    },
    mkdir: (path, options) => sandbox.mkdir(path, options),
    writeFile: (path, content) => sandbox.writeFile(path, content),
    readFile: (path, options) => sandbox.readFile(path, options),
    listFiles: async (path, options) => {
      const result = await sandbox.listFiles(path, options);
      return {
        files: result.files.map((file) => ({
          absolutePath: file.absolutePath,
          type: file.type,
        })),
      };
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
