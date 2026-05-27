import { Result, type Result as BetterResult } from "better-result";
import {
  attachWorkspaceMount,
  type WorkspaceMountError,
  type WorkspaceMountFiles,
  type WorkspaceMountFlushSummary,
} from "../projections/working-copy-mount";

export type WorkspaceFileAttachmentHostEntry = {
  path: string;
  type: "directory" | "file" | "symlink" | "other";
};

export type WorkspaceFileAttachmentHost = {
  resetDirectory?(path: string): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  listTree(path: string): Promise<WorkspaceFileAttachmentHostEntry[]>;
};

export type WorkspaceFileCaptureSummary = WorkspaceMountFlushSummary;

export type WorkspaceFileAttachmentError =
  | { tag: "WorkspaceFileAttachmentOperationError"; operation: string; errorTag: string; message: string }
  | { tag: "WorkspaceFileAttachmentUnsupportedEntryError"; path: string; entryType: string; message: string }
  | { tag: "WorkspaceFileAttachmentPathEscapeError"; root: string; path: string; message: string };

export type WorkspaceFileAttachment = {
  path: string;
  capture(): Promise<BetterResult<WorkspaceFileCaptureSummary, WorkspaceFileAttachmentError>>;
};

export async function attachWorkspaceFiles(
  files: WorkspaceMountFiles,
  host: WorkspaceFileAttachmentHost,
  path: string,
): Promise<BetterResult<WorkspaceFileAttachment, WorkspaceFileAttachmentError>> {
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
    return Result.err(attachmentError(mount.error));
  }

  return Result.ok({
    path: mount.value.root,
    capture: async () => {
      const capture = await mount.value.flush();
      if (Result.isError(capture)) {
        return Result.err(attachmentError(capture.error));
      }

      return Result.ok(capture.value);
    },
  });
}

function attachmentError(error: WorkspaceMountError): WorkspaceFileAttachmentError {
  if ("operation" in error && "errorTag" in error) {
    return {
      tag: "WorkspaceFileAttachmentOperationError",
      operation: error.operation,
      errorTag: error.errorTag,
      message: error.message,
    };
  }

  if ("entryType" in error) {
    return {
      tag: "WorkspaceFileAttachmentUnsupportedEntryError",
      path: error.path,
      entryType: error.entryType,
      message: error.message,
    };
  }

  return {
    tag: "WorkspaceFileAttachmentPathEscapeError",
    root: error.root,
    path: error.path,
    message: error.message,
  };
}
