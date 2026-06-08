import { Result, type Result as BetterResult } from "better-result";
import {
  attachWorkspaceMount,
  type WorkspaceMountError,
  type WorkspaceMountFiles,
  type WorkspaceMountReconcileSummary,
} from "./projections/working-copy-mount";

export type WorkspaceFileMountHostEntry = {
  path: string;
  type: "directory" | "file" | "symlink" | "other";
};

export type WorkspaceFileMountHost = {
  resetDirectory?(path: string): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  listTree(path: string): Promise<WorkspaceFileMountHostEntry[]>;
};

export type WorkspaceFileReconcileSummary = WorkspaceMountReconcileSummary;

export type WorkspaceFileMountError =
  | { tag: "WorkspaceFileMountOperationError"; operation: string; errorTag: string; message: string }
  | { tag: "WorkspaceFileMountUnsupportedEntryError"; path: string; entryType: string; message: string }
  | { tag: "WorkspaceFileMountPathEscapeError"; root: string; path: string; message: string };

export type WorkspaceFileMount = {
  path: string;
  reconcile(): Promise<BetterResult<WorkspaceFileReconcileSummary, WorkspaceFileMountError>>;
};

export async function attachWorkspaceFiles(
  files: WorkspaceMountFiles,
  host: WorkspaceFileMountHost,
  path: string,
): Promise<BetterResult<WorkspaceFileMount, WorkspaceFileMountError>> {
  const mount = await attachWorkspaceMount({
    files,
    root: path,
    host: {
      resetDirectory: host.resetDirectory?.bind(host),
      mkdir: (hostPath, options) => host.mkdir(hostPath, options),
      writeFile: (hostPath, contents) => host.writeFile(hostPath, contents),
      readFile: (hostPath) => host.readFile(hostPath),
      listFiles: (hostPath) => host.listTree(hostPath),
    },
  });

  if (Result.isError(mount)) {
    return Result.err(mountError(mount.error));
  }

  return Result.ok({
    path: mount.value.root,
    reconcile: async () => {
      const reconcile = await mount.value.reconcile();
      if (Result.isError(reconcile)) {
        return Result.err(mountError(reconcile.error));
      }

      return Result.ok(reconcile.value);
    },
  });
}

function mountError(error: WorkspaceMountError): WorkspaceFileMountError {
  if ("operation" in error && "errorTag" in error) {
    return {
      tag: "WorkspaceFileMountOperationError",
      operation: error.operation,
      errorTag: error.errorTag,
      message: error.message,
    };
  }

  if ("entryType" in error) {
    return {
      tag: "WorkspaceFileMountUnsupportedEntryError",
      path: error.path,
      entryType: error.entryType,
      message: error.message,
    };
  }

  return {
    tag: "WorkspaceFileMountPathEscapeError",
    root: error.root,
    path: error.path,
    message: error.message,
  };
}
