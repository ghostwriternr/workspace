import { Result, type Result as BetterResult } from "better-result";
import type {
  WorkspaceFileCopyFiles,
  WorkspaceFileMountError,
  WorkspaceFileMountHost,
  WorkspaceFileReconcileSummary,
} from "@cloudflare/workspace";

export type WorkspaceSandboxCommandResult = {
  command: string;
  root: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  reconcile: WorkspaceFileReconcileSummary;
};

export type WorkspaceSandboxCommandError =
  | {
      tag: "WorkspaceSandboxMountError";
      operation: "attach" | "reconcile";
      message: string;
      error: WorkspaceFileMountError;
    }
  | {
      tag: "WorkspaceSandboxExecutionError";
      message: string;
    };

export type WorkspaceSandboxRunCommandOptions = {
  files: Pick<WorkspaceFileCopyFiles, "attach">;
  sandboxId: string;
  command: string;
  root?: string;
};

export type WorkspaceSandboxCommandRunner = {
  runCommand(options: WorkspaceSandboxRunCommandOptions): Promise<BetterResult<WorkspaceSandboxCommandResult, WorkspaceSandboxCommandError>>;
};

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

export type WorkspaceSandboxClient = {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  exec(command: string, options?: { cwd?: string }): Promise<ExecResult>;
  writeFile(path: string, content: ReadableStream<Uint8Array>): Promise<unknown>;
  readFile(path: string, options: { encoding: "none" }): Promise<{ success: true; content: ReadableStream<Uint8Array> }>;
  listFiles(path: string, options?: { recursive?: boolean; includeHidden?: boolean }): Promise<SandboxListFilesResult>;
};

export type WorkspaceSandboxClientFactory = (sandboxId: string) => WorkspaceSandboxClient;

const DEFAULT_ROOT = "/workspace";

export function createWorkspaceSandboxCommandRunner(
  sandbox: WorkspaceSandboxClient | WorkspaceSandboxClientFactory,
): WorkspaceSandboxCommandRunner {
  return {
    async runCommand(options) {
      const client = typeof sandbox === "function" ? sandbox(options.sandboxId) : sandbox;
      const root = options.root ?? DEFAULT_ROOT;
      let mount: Awaited<ReturnType<typeof options.files.attach>>;
      try {
        mount = await options.files.attach(sandboxMountHost(client), root);
      } catch (error) {
        return Result.err(mountException("attach", error));
      }
      if (Result.isError(mount)) {
        return Result.err(mountError("attach", mount.error));
      }

      let commandResult: ExecResult;
      try {
        commandResult = await client.exec(options.command, { cwd: mount.value.path });
      } catch (error) {
        return Result.err({
          tag: "WorkspaceSandboxExecutionError",
          message: error instanceof Error ? error.message : "Sandbox command failed.",
        });
      }

      let reconcile: Awaited<ReturnType<typeof mount.value.reconcile>>;
      try {
        reconcile = await mount.value.reconcile();
      } catch (error) {
        return Result.err(mountException("reconcile", error));
      }
      if (Result.isError(reconcile)) {
        return Result.err(mountError("reconcile", reconcile.error));
      }

      return Result.ok({
        command: options.command,
        root: mount.value.path,
        exitCode: commandResult.exitCode,
        stdout: commandResult.stdout,
        stderr: commandResult.stderr,
        reconcile: reconcile.value,
      });
    },
  };
}

function sandboxMountHost(sandbox: WorkspaceSandboxClient): WorkspaceFileMountHost {
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

function mountError(operation: "attach" | "reconcile", error: WorkspaceFileMountError): WorkspaceSandboxCommandError {
  return {
    tag: "WorkspaceSandboxMountError",
    operation,
    message: error.message,
    error,
  };
}

function mountException(operation: "attach" | "reconcile", error: unknown): WorkspaceSandboxCommandError {
  const message = error instanceof Error ? error.message : "Workspace Sandbox mount operation failed.";
  return mountError(operation, {
    tag: "WorkspaceFileMountOperationError",
    operation,
    errorTag: error instanceof Error ? error.name : "UnknownError",
    message,
  });
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
