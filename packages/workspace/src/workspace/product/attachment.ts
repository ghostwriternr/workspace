import { Result, type Result as BetterResult } from "better-result";
import {
  attachWorkspaceMount,
  type WorkspaceMountError,
  type WorkspaceMountFiles,
  type WorkspaceMountFlushSummary,
  type WorkspaceMountHost,
} from "../projections/working-copy-mount";

export type WorkspaceFileAttachmentHost = {
  resetDirectory(path: string): Promise<unknown>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, content: ReadableStream<Uint8Array>): Promise<unknown>;
  readFile(path: string, options: { encoding: "none" }): Promise<{ content: ReadableStream<Uint8Array> }>;
  listFiles(path: string, options: { recursive: boolean; includeHidden: boolean }): Promise<{
    files: Array<{ absolutePath: string; type: "directory" | "file" | "symlink" | "other" }>;
  }>;
};

export type WorkspaceFileCaptureSummary = WorkspaceMountFlushSummary;
export type WorkspaceFileAttachmentError = WorkspaceMountError;

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
    host: new WorkspaceFileAttachmentMountHost(host),
    root: path,
  });

  if (Result.isError(mount)) {
    return Result.err(mount.error);
  }

  return Result.ok({
    path: mount.value.root,
    capture: () => mount.value.flush(),
  });
}

class WorkspaceFileAttachmentMountHost implements WorkspaceMountHost {
  constructor(private readonly host: WorkspaceFileAttachmentHost) {}

  async resetDirectory(path: string): Promise<void> {
    await this.host.resetDirectory(path);
  }

  async mkdir(path: string, options: { recursive: boolean }): Promise<void> {
    await this.host.mkdir(path, options);
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    await this.host.writeFile(path, bytesToStream(contents));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const result = await this.host.readFile(path, { encoding: "none" });
    return collectStream(result.content);
  }

  async listFiles(path: string): Promise<Array<{ path: string; type: "directory" | "file" | "symlink" | "other" }>> {
    const result = await this.host.listFiles(path, { recursive: true, includeHidden: true });
    return result.files.map((file) => ({
      path: file.absolutePath,
      type: file.type,
    }));
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
