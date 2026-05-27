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
  WorkspaceSessionLookupRpcResult,
  WorkspaceSessionMkdirRpcResult,
  WorkspaceSessionReadRpcResult,
  WorkspaceSessionStatRpcResult,
  WorkspaceSessionWriteRpcResult,
  WorkspaceStat,
  WorkspaceStatRpcResult,
  WorkspaceWriteRpcResult,
} from "../model/rpc";

type WorkspaceSessionClientLookupResult =
  | { status: "ok"; value: WorkspaceSessionClient }
  | { status: "error"; error: RpcErrorOf<WorkspaceSessionLookupRpcResult> };

export type WorkspaceObjectClient = {
  beginSession(): Promise<WorkspaceSessionClient>;
  getSession(id: string): Promise<WorkspaceSessionClientLookupResult>;
  mkdir(path: string): Promise<WorkspaceMkdirRpcResult>;
  writeFile(path: string, contents: Uint8Array): Promise<WorkspaceWriteRpcResult>;
  readFile(path: string): Promise<WorkspaceReadRpcResult>;
  list(path: string): Promise<WorkspaceListRpcResult>;
  stat(path: string): Promise<WorkspaceStatRpcResult>;
  delete(path: string): Promise<WorkspaceDeleteRpcResult>;
};

export type WorkspaceSessionClient = Disposable & {
  info(): Promise<WorkspaceSessionInfoRpcResult>;
  mkdir(path: string): Promise<WorkspaceSessionMkdirRpcResult>;
  writeFile(path: string, contents: Uint8Array): Promise<WorkspaceSessionWriteRpcResult>;
  readFile(path: string): Promise<WorkspaceSessionReadRpcResult>;
  list(path: string): Promise<WorkspaceSessionListRpcResult>;
  stat(path: string): Promise<WorkspaceSessionStatRpcResult>;
  delete(path: string): Promise<WorkspaceSessionDeleteRpcResult>;
  commit(): Promise<WorkspaceSessionCommitRpcResult>;
  discard(): Promise<WorkspaceSessionDiscardRpcResult>;
};

export type WorkspaceNamespace = {
  getByName(name: string): WorkspaceObjectClient;
};

export type WorkspaceCurrentFiles = WorkspaceFilesApi & {
  copy(name?: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>>;
  getCopy(id: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyLookupError>>;
};

export type WorkspaceCopyFiles = WorkspaceFilesApi;

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
export type WorkspaceCopyLookupError = RpcErrorOf<WorkspaceSessionLookupRpcResult> | WorkspaceCopyError;
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
  readonly files: WorkspaceCopyFiles;

  constructor(
    private readonly object: WorkspaceObjectClient,
    readonly id: string,
    readonly createdAt: number,
  ) {
    this.files = new WorkspaceCopyFilesHandle(object, id);
  }

  async apply(): Promise<BetterResult<WorkspaceRevision, WorkspaceApplyError>> {
    return this.withSession((session) => session.commit());
  }

  async discard(): Promise<BetterResult<void, WorkspaceDiscardError>> {
    return this.withSession((session) => session.discard());
  }

  private async withSession<T, E>(
    useSession: (session: WorkspaceSessionClient) => Promise<RpcResult<T, E>>,
  ): Promise<BetterResult<T, E | WorkspaceCopyLookupError>> {
    return withWorkspaceSession(this.object, this.id, useSession);
  }
}

class WorkspaceCopyFilesHandle implements WorkspaceCopyFiles {
  constructor(
    private readonly object: WorkspaceObjectClient,
    private readonly copyId: string,
  ) {}

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceFileError>> {
    return this.withSession((session) => session.mkdir(path));
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceFileError>> {
    return this.withSession((session) => session.writeFile(path, contents));
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceFileError>> {
    return this.withSession((session) => session.readFile(path));
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceFileError>> {
    return this.withSession((session) => session.list(path));
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceFileError>> {
    return this.withSession((session) => session.stat(path));
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceFileError>> {
    return this.withSession((session) => session.delete(path));
  }

  private async withSession<T, E>(
    useSession: (session: WorkspaceSessionClient) => Promise<RpcResult<T, E>>,
  ): Promise<BetterResult<T, E | WorkspaceCopyLookupError>> {
    return withWorkspaceSession(this.object, this.copyId, useSession);
  }
}

class WorkspaceFiles implements WorkspaceCurrentFiles {
  constructor(private readonly object: WorkspaceObjectClient) {}

  async copy(_name?: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>> {
    const session = await this.object.beginSession();
    return copyFromSession(this.object, session);
  }

  async getCopy(id: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyLookupError>> {
    const session = rpcToResult(await this.object.getSession(id));
    if (Result.isError(session)) {
      return Result.err(session.error);
    }

    return copyFromSession(this.object, session.value);
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

async function copyFromSession(
  object: WorkspaceObjectClient,
  session: WorkspaceSessionClient,
): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>> {
  try {
    const info = rpcToResult(await session.info());
    if (Result.isError(info)) {
      return Result.err(info.error);
    }

    return Result.ok(new WorkspaceFileCopy(object, info.value.sessionId, info.value.createdAt));
  } finally {
    disposeRpc(session);
  }
}

async function withWorkspaceSession<T, E>(
  object: WorkspaceObjectClient,
  copyId: string,
  useSession: (session: WorkspaceSessionClient) => Promise<RpcResult<T, E>>,
): Promise<BetterResult<T, E | WorkspaceCopyLookupError>> {
  const session = rpcToResult(await object.getSession(copyId));
  if (Result.isError(session)) {
    return Result.err(session.error);
  }

  try {
    return rpcToResult(await useSession(session.value));
  } finally {
    disposeRpc(session.value);
  }
}

function rpcToResult<T, E>(result: RpcResult<T, E>): BetterResult<T, E> {
  if (result.status === "error") {
    return Result.err(result.error);
  }

  return Result.ok(result.value as T);
}

function disposeRpc(value: { [Symbol.dispose]?: () => void }): void {
  value[Symbol.dispose]?.();
}
