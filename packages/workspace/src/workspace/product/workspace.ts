import { Result, type Result as BetterResult } from "better-result";
import {
  attachWorkspaceFiles,
  type WorkspaceFileAttachment,
  type WorkspaceFileAttachmentError,
  type WorkspaceFileAttachmentHost,
} from "./attachment";
import {
  writeTreeEntries,
  type WorkspaceFileWriteTreeError,
  type WorkspaceTreeEntries,
  type WorkspaceTreeEntryTooLargeError,
  type WorkspaceTreeSourceError,
} from "./write-tree";
import { createWorkspaceFileCapability, type ScopedWorkspaceFileCapability } from "../projections/scoped-file-capability";
import type {
  WorkspaceDeleteRpcResult,
  WorkspaceEntry,
  WorkspaceListRpcResult,
  WorkspaceMkdirRpcResult,
  WorkspaceReadRpcResult,
  WorkspaceRevision,
  WorkspaceSessionCommitRpcResult,
  WorkspaceSessionDeleteRpcResult,
  WorkspaceSessionDiscardRpcResult,
  WorkspaceSessionInfoRpcResult,
  WorkspaceSessionListRpcResult,
  WorkspaceSessionMkdirRpcResult,
  WorkspaceSessionReadRpcResult,
  WorkspaceSessionStatRpcResult,
  WorkspaceSessionWriteRpcResult,
  WorkspaceSessionWriteTreeBatchRpcResult,
  WorkspaceStat,
  WorkspaceStatRpcResult,
  WorkspaceWriteRpcResult,
} from "../model/rpc";
import type { WorkspaceTreeEntry } from "../model/write-tree";

export type WorkspaceObjectClient = {
  beginSession(): Promise<WorkspaceSessionInfoRpcResult>;
  getSession(id: string): Promise<WorkspaceSessionInfoRpcResult>;
  mkdir(path: string): Promise<WorkspaceMkdirRpcResult>;
  writeFile(path: string, contents: Uint8Array): Promise<WorkspaceWriteRpcResult>;
  readFile(path: string): Promise<WorkspaceReadRpcResult>;
  list(path: string): Promise<WorkspaceListRpcResult>;
  stat(path: string): Promise<WorkspaceStatRpcResult>;
  delete(path: string): Promise<WorkspaceDeleteRpcResult>;
  sessionMkdir(id: string, path: string): Promise<WorkspaceSessionMkdirRpcResult>;
  sessionWriteFile(id: string, path: string, contents: Uint8Array): Promise<WorkspaceSessionWriteRpcResult>;
  sessionWriteTreeBatch(id: string, root: string, entries: WorkspaceTreeEntry[]): Promise<WorkspaceSessionWriteTreeBatchRpcResult>;
  sessionReadFile(id: string, path: string): Promise<WorkspaceSessionReadRpcResult>;
  sessionList(id: string, path: string): Promise<WorkspaceSessionListRpcResult>;
  sessionStat(id: string, path: string): Promise<WorkspaceSessionStatRpcResult>;
  sessionDelete(id: string, path: string): Promise<WorkspaceSessionDeleteRpcResult>;
  sessionCommit(id: string): Promise<WorkspaceSessionCommitRpcResult>;
  sessionDiscard(id: string): Promise<WorkspaceSessionDiscardRpcResult>;
};

export type WorkspaceNamespace = {
  getByName(name: string): WorkspaceObjectClient;
};

export type WorkspaceCurrentFiles = WorkspaceCurrentFilesApi & {
  copy(name?: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>>;
  getCopy(id: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyLookupError>>;
};

export type { WorkspaceFileWriteTreeError, WorkspaceTreeEntries, WorkspaceTreeEntryTooLargeError, WorkspaceTreeSourceError };

export type WorkspaceCurrentFilesApi = {
  mkdir(path: string): Promise<BetterResult<void, WorkspaceCurrentFileMkdirError>>;
  write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCurrentFileWriteError>>;
  read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCurrentFileReadError>>;
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCurrentFileListError>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCurrentFileStatError>>;
  delete(path: string): Promise<BetterResult<void, WorkspaceCurrentFileDeleteError>>;
};

export type WorkspaceCopyFilesApi = {
  mkdir(path: string): Promise<BetterResult<void, WorkspaceCopyFileMkdirError>>;
  write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCopyFileWriteError>>;
  read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCopyFileReadError>>;
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCopyFileListError>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCopyFileStatError>>;
  delete(path: string): Promise<BetterResult<void, WorkspaceCopyFileDeleteError>>;
};

export type WorkspaceFileScope = {
  root?: string;
  read: string | string[];
  write: string | string[];
};

export type WorkspaceFileCopyFiles = WorkspaceCopyFilesApi & {
  writeTree(root: string, entries: WorkspaceTreeEntries): Promise<BetterResult<void, WorkspaceFileWriteTreeError>>;
  attach(host: WorkspaceFileAttachmentHost, path: string): Promise<BetterResult<WorkspaceFileAttachment, WorkspaceFileAttachmentError>>;
  scoped(options: WorkspaceFileScope): ScopedWorkspaceFileCapability;
};

type RpcErrorOf<T> = T extends { status: "error"; error: infer E } ? E : never;

export type WorkspaceCurrentFileMkdirError = RpcErrorOf<WorkspaceMkdirRpcResult>;
export type WorkspaceCurrentFileWriteError = RpcErrorOf<WorkspaceWriteRpcResult>;
export type WorkspaceCurrentFileReadError = RpcErrorOf<WorkspaceReadRpcResult>;
export type WorkspaceCurrentFileListError = RpcErrorOf<WorkspaceListRpcResult>;
export type WorkspaceCurrentFileStatError = RpcErrorOf<WorkspaceStatRpcResult>;
export type WorkspaceCurrentFileDeleteError = RpcErrorOf<WorkspaceDeleteRpcResult>;

export type WorkspaceCopyFileMkdirError = RpcErrorOf<WorkspaceSessionMkdirRpcResult>;
export type WorkspaceCopyFileWriteError = RpcErrorOf<WorkspaceSessionWriteRpcResult>;
export type WorkspaceCopyFileReadError = RpcErrorOf<WorkspaceSessionReadRpcResult>;
export type WorkspaceCopyFileListError = RpcErrorOf<WorkspaceSessionListRpcResult>;
export type WorkspaceCopyFileStatError = RpcErrorOf<WorkspaceSessionStatRpcResult>;
export type WorkspaceCopyFileDeleteError = RpcErrorOf<WorkspaceSessionDeleteRpcResult>;

export type WorkspaceCopyError = RpcErrorOf<WorkspaceSessionInfoRpcResult>;
export type WorkspaceCopyLookupError = RpcErrorOf<WorkspaceSessionInfoRpcResult>;
export type WorkspaceApplyError = RpcErrorOf<WorkspaceSessionCommitRpcResult>;
export type WorkspaceDiscardError = RpcErrorOf<WorkspaceSessionDiscardRpcResult>;

export class Workspace {
  static get(namespace: WorkspaceNamespace, name: string): Workspace {
    return new Workspace(namespace.getByName(name));
  }

  readonly files: WorkspaceCurrentFiles;

  private constructor(private readonly object: WorkspaceObjectClient) {
    this.files = new WorkspaceFiles(object);
  }
}

export class WorkspaceFileCopy {
  readonly files: WorkspaceFileCopyFiles;

  constructor(
    private readonly object: WorkspaceObjectClient,
    readonly id: string,
    readonly createdAt: number,
  ) {
    this.files = new WorkspaceCopyFiles(object, id);
  }

  async apply(): Promise<BetterResult<WorkspaceRevision, WorkspaceApplyError>> {
    return rpcToResult(await this.object.sessionCommit(this.id));
  }

  async discard(): Promise<BetterResult<void, WorkspaceDiscardError>> {
    return rpcToResult(await this.object.sessionDiscard(this.id));
  }
}

class WorkspaceCopyFiles implements WorkspaceFileCopyFiles {
  constructor(
    private readonly object: WorkspaceObjectClient,
    private readonly copyId: string,
  ) {}

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceCopyFileMkdirError>> {
    return rpcToResult(await this.object.sessionMkdir(this.copyId, path));
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCopyFileWriteError>> {
    return rpcToResult(await this.object.sessionWriteFile(this.copyId, path, contents));
  }

  async writeTree(root: string, entries: WorkspaceTreeEntries): Promise<BetterResult<void, WorkspaceFileWriteTreeError>> {
    return writeTreeEntries(entries, (batch) => this.object.sessionWriteTreeBatch(this.copyId, root, batch));
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCopyFileReadError>> {
    return rpcToResult(await this.object.sessionReadFile(this.copyId, path));
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCopyFileListError>> {
    return rpcToResult(await this.object.sessionList(this.copyId, path));
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCopyFileStatError>> {
    return rpcToResult(await this.object.sessionStat(this.copyId, path));
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceCopyFileDeleteError>> {
    return rpcToResult(await this.object.sessionDelete(this.copyId, path));
  }

  async attach(host: WorkspaceFileAttachmentHost, path: string): Promise<BetterResult<WorkspaceFileAttachment, WorkspaceFileAttachmentError>> {
    return attachWorkspaceFiles(this, host, path);
  }

  scoped(options: WorkspaceFileScope): ScopedWorkspaceFileCapability {
    return createWorkspaceFileCapability({
      files: this,
      root: options.root ?? "/",
      read: arrayOf(options.read),
      write: arrayOf(options.write),
    });
  }
}

class WorkspaceFiles implements WorkspaceCurrentFiles {
  constructor(private readonly object: WorkspaceObjectClient) {}

  async copy(_name?: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>> {
    const info = rpcToResult(await this.object.beginSession());
    if (Result.isError(info)) {
      return Result.err(info.error);
    }

    return Result.ok(new WorkspaceFileCopy(this.object, info.value.sessionId, info.value.createdAt));
  }

  async getCopy(id: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyLookupError>> {
    const info = rpcToResult(await this.object.getSession(id));
    if (Result.isError(info)) {
      return Result.err(info.error);
    }

    return Result.ok(new WorkspaceFileCopy(this.object, info.value.sessionId, info.value.createdAt));
  }

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceCurrentFileMkdirError>> {
    return rpcToResult(await this.object.mkdir(path));
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCurrentFileWriteError>> {
    return rpcToResult(await this.object.writeFile(path, contents));
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCurrentFileReadError>> {
    return rpcToResult(await this.object.readFile(path));
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCurrentFileListError>> {
    return rpcToResult(await this.object.list(path));
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCurrentFileStatError>> {
    return rpcToResult(await this.object.stat(path));
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceCurrentFileDeleteError>> {
    return rpcToResult(await this.object.delete(path));
  }
}

type RpcResult<T, E> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: E };

function arrayOf(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function rpcToResult<T, E>(result: RpcResult<T, E>): BetterResult<T, E> {
  if (result.status === "error") {
    return Result.err(result.error);
  }

  return Result.ok(result.value as T);
}
