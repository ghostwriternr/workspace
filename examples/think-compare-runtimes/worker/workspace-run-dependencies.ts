import { Result, type Result as BetterResult } from "better-result";

import { createSandboxWarmPool } from "./sandbox-warm-pool";
import type { StartComparisonRunOptions } from "./runs";
import { createWorkspaceBackedRuntime } from "./runtimes/workspace-runtime";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface WorkspaceCopyLike {
  id: string;
  files: {
    writeTree(root: string, entries: { path: string; contents: Uint8Array }[]): Promise<BetterResult<void, unknown>>;
    read(path: string): Promise<BetterResult<Uint8Array, unknown>>;
    scoped(options: { root: string; read: string; write: string }): unknown;
  };
}

interface WorkspaceLike {
  copies: {
    create(options: { label: string }): Promise<BetterResult<WorkspaceCopyLike, unknown>>;
  };
}

interface WorkspaceRunLease {
  id: string;
}

export interface WorkspaceRunDependencyOptions {
  workspace: WorkspaceLike;
  runDynamicWorker(input: { code: string; workspace: unknown }): Promise<unknown>;
  runShell(input: {
    copyId: string;
    lease: WorkspaceRunLease;
    command: string;
    cwd: string;
  }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  captureShell(input: { copyId: string; lease: WorkspaceRunLease }): Promise<void>;
}

export function createWorkspaceRunOptions(
  options: WorkspaceRunDependencyOptions,
): Pick<StartComparisonRunOptions, "createWorkspaceRuntime" | "workspaceSandboxPool"> {
  return {
    workspaceSandboxPool: createSandboxWarmPool({ prefix: "workspace-sandbox", size: 2 }),
    async createWorkspaceRuntime(lease) {
      const copy = await options.workspace.copies.create({ label: "think-runtime-comparison" });
      if (Result.isError(copy)) {
        throw new Error(copy.error instanceof Error ? copy.error.message : JSON.stringify(copy.error));
      }

      return createWorkspaceBackedRuntime({
        async writeFile(path, contents) {
          const written = await copy.value.files.writeTree("/", [
            { path: relativeTreePath(path), contents: encoder.encode(contents) },
          ]);
          if (Result.isError(written)) {
            throw new Error(written.error instanceof Error ? written.error.message : JSON.stringify(written.error));
          }
        },
        async readFile(path) {
          const read = await copy.value.files.read(path);
          if (Result.isError(read)) {
            throw new Error(read.error instanceof Error ? read.error.message : JSON.stringify(read.error));
          }
          return decoder.decode(read.value);
        },
        runDynamicWorker(code) {
          return options.runDynamicWorker({
            code,
            workspace: copy.value.files.scoped({ root: "/", read: "/", write: "/" }),
          });
        },
        runSandboxCommand(command, shellOptions) {
          return options.runShell({ copyId: copy.value.id, lease, command, cwd: shellOptions.cwd });
        },
        captureSandboxChanges() {
          return options.captureShell({ copyId: copy.value.id, lease });
        },
      });
    },
  };
}

function relativeTreePath(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}
