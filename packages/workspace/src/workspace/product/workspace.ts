import { Result, type Result as BetterResult } from "better-result";
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
  WorkspaceStat,
  WorkspaceStatRpcResult,
  WorkspaceWriteRpcResult,
} from "../model/rpc";

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

export type WorkspaceCurrentFiles = WorkspaceFilesApi & {
  copy(name?: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>>;
  getCopy(id: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyLookupError>>;
};

export type WorkspaceFilesApi = {
  mkdir(path: string): Promise<BetterResult<void, WorkspaceFileError>>;
  write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceFileError>>;
  read(path: string): Promise<BetterResult<Uint8Array, WorkspaceFileError>>;
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceFileError>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceFileError>>;
  delete(path: string): Promise<BetterResult<void, WorkspaceFileError>>;
};

type RpcErrorOf<T> = T extends { status: "error"; error: infer E } ? E : never;

export type WorkspaceFileError =
  | RpcErrorOf<WorkspaceMkdirRpcResult>
  | RpcErrorOf<WorkspaceWriteRpcResult>
  | RpcErrorOf<WorkspaceReadRpcResult>
  | RpcErrorOf<WorkspaceListRpcResult>
  | RpcErrorOf<WorkspaceStatRpcResult>
  | RpcErrorOf<WorkspaceDeleteRpcResult>
  | RpcErrorOf<WorkspaceSessionMkdirRpcResult>
  | RpcErrorOf<WorkspaceSessionWriteRpcResult>
  | RpcErrorOf<WorkspaceSessionReadRpcResult>
  | RpcErrorOf<WorkspaceSessionListRpcResult>
  | RpcErrorOf<WorkspaceSessionStatRpcResult>
  | RpcErrorOf<WorkspaceSessionDeleteRpcResult>;

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
  readonly files: WorkspaceFilesApi;

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

class WorkspaceCopyFiles implements WorkspaceFilesApi {
  constructor(
    private readonly object: WorkspaceObjectClient,
    private readonly copyId: string,
  ) {}

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceFileError>> {
    return rpcToResult(await this.object.sessionMkdir(this.copyId, path));
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceFileError>> {
    return rpcToResult(await this.object.sessionWriteFile(this.copyId, path, contents));
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceFileError>> {
    return rpcToResult(await this.object.sessionReadFile(this.copyId, path));
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceFileError>> {
    return rpcToResult(await this.object.sessionList(this.copyId, path));
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceFileError>> {
    return rpcToResult(await this.object.sessionStat(this.copyId, path));
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceFileError>> {
    return rpcToResult(await this.object.sessionDelete(this.copyId, path));
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

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceFileError>> {
    return rpcToResult(await this.object.mkdir(path));
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceFileError>> {
    return rpcToResult(await this.object.writeFile(path, contents));
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceFileError>> {
    return rpcToResult(await this.object.readFile(path));
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceFileError>> {
    return rpcToResult(await this.object.list(path));
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceFileError>> {
    return rpcToResult(await this.object.stat(path));
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceFileError>> {
    return rpcToResult(await this.object.delete(path));
  }
}

type RpcResult<T, E> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: E };

function rpcToResult<T, E>(result: RpcResult<T, E>): BetterResult<T, E> {
  if (result.status === "error") {
    return Result.err(result.error);
  }

  return Result.ok(result.value as T);
}
