import { Result, type Result as BetterResult } from "better-result";
import type { WorkspaceAuthority, WorkspaceAuthorityCopy, WorkspaceAuthorityFiles } from "./authority";
import {
  attachWorkspaceFiles,
  type WorkspaceFileMount,
  type WorkspaceFileMountError,
  type WorkspaceFileMountHost,
} from "./mount";
import {
  writeTreeEntries,
  type WorkspaceFileWriteTreeError as WorkspaceFileWriteTreeStreamError,
  type WorkspaceTreeEntries,
  type WorkspaceTreeEntryTooLargeError,
  type WorkspaceTreeSourceError,
} from "./write-tree";
import {
  createArtifactsWorkspaceAuthority,
  type ArtifactsBindingClient,
} from "./artifacts/authority";
import type { WorkspaceObjectClient } from "./workspace-object";
import type { ErrorDtoFor } from "./model/errors";
import type {
  WorkspaceApplyError as WorkspaceApplyDomainError,
  WorkspaceCopyError as WorkspaceCopyDomainError,
  WorkspaceCopyFileError as WorkspaceCopyFileDomainError,
  WorkspaceDeleteError,
  WorkspaceDiscardError as WorkspaceDiscardDomainError,
  WorkspaceListError,
  WorkspaceMkdirError,
  WorkspaceReadError,
  WorkspaceStatError,
  WorkspaceWriteError,
} from "./model/errors";
import type { WorkspaceEntry, WorkspaceRevision, WorkspaceStat } from "./model/entries";
import { createWorkspaceFileCapability, type ScopedWorkspaceFileCapability } from "./projections/scoped-file-capability";

export type WorkspaceCurrentFiles = WorkspaceCurrentFilesApi & {
  copy(name?: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>>;
  getCopy(id: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyLookupError>>;
};

export type { WorkspaceTreeEntries, WorkspaceTreeEntryTooLargeError, WorkspaceTreeSourceError };
export type WorkspaceFileWriteTreeError = WorkspaceFileWriteTreeStreamError | WorkspaceCopyFileError;

export type WorkspaceFilesApi<E> = {
  mkdir(path: string): Promise<BetterResult<void, E>>;
  write(path: string, contents: Uint8Array): Promise<BetterResult<void, E>>;
  read(path: string): Promise<BetterResult<Uint8Array, E>>;
  list(path: string): Promise<BetterResult<WorkspaceEntry[], E>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, E>>;
  delete(path: string): Promise<BetterResult<void, E>>;
};

export type WorkspaceCurrentFilesApi = WorkspaceFilesApi<WorkspaceCurrentFileError>;
export type WorkspaceCopyFilesApi = WorkspaceFilesApi<WorkspaceCopyFileError>;

export type WorkspaceFileScope = {
  root?: string;
  read: string | string[];
  write: string | string[];
};

export type WorkspaceFileCopyFiles = WorkspaceCopyFilesApi & {
  writeTree(root: string, entries: WorkspaceTreeEntries): Promise<BetterResult<void, WorkspaceFileWriteTreeError>>;
  attach(host: WorkspaceFileMountHost, path: string): Promise<BetterResult<WorkspaceFileMount, WorkspaceFileMountError>>;
  scoped(options: WorkspaceFileScope): ScopedWorkspaceFileCapability;
};

export type WorkspaceCurrentFileError = ErrorDtoFor<
  WorkspaceMkdirError | WorkspaceWriteError | WorkspaceReadError | WorkspaceListError | WorkspaceStatError | WorkspaceDeleteError
>;

export type WorkspaceCopyFileError = ErrorDtoFor<WorkspaceCopyFileDomainError>;
export type WorkspaceCopyError = ErrorDtoFor<WorkspaceCopyDomainError>;
export type WorkspaceCopyLookupError = ErrorDtoFor<WorkspaceCopyDomainError>;
export type WorkspaceApplyError = ErrorDtoFor<WorkspaceApplyDomainError>;
export type WorkspaceDiscardError = ErrorDtoFor<WorkspaceDiscardDomainError>;

export type WorkspaceArtifactsOptions = {
  artifacts: ArtifactsBindingClient;
  object: WorkspaceObjectClient;
  name: string;
};

export class Workspace {
  static fromArtifacts(options: WorkspaceArtifactsOptions): Workspace {
    return new Workspace(createArtifactsWorkspaceAuthority(options));
  }

  readonly files: WorkspaceCurrentFiles;

  private constructor(private readonly authority: WorkspaceAuthority<WorkspaceCurrentFileError, WorkspaceCopyError, WorkspaceCopyLookupError, WorkspaceCopyFileError, WorkspaceApplyError, WorkspaceDiscardError>) {
    this.files = new WorkspaceFiles(authority);
  }
}

export class WorkspaceFileCopy {
  readonly files: WorkspaceFileCopyFiles;

  constructor(private readonly copy: WorkspaceAuthorityCopy<WorkspaceCopyFileError, WorkspaceApplyError, WorkspaceDiscardError>) {
    this.id = copy.id;
    this.createdAt = copy.createdAt;
    this.files = new WorkspaceCopyFiles(copy.files);
  }

  readonly id: string;
  readonly createdAt: number;

  async apply(): Promise<BetterResult<WorkspaceRevision, WorkspaceApplyError>> {
    return this.copy.apply();
  }

  async discard(): Promise<BetterResult<void, WorkspaceDiscardError>> {
    return this.copy.discard();
  }
}

class WorkspaceCopyFiles implements WorkspaceFileCopyFiles {
  constructor(private readonly files: WorkspaceAuthorityFiles<WorkspaceCopyFileError>) {}

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceCopyFileError>> {
    return this.files.mkdir(path);
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCopyFileError>> {
    return this.files.write(path, contents);
  }

  async writeTree(root: string, entries: WorkspaceTreeEntries): Promise<BetterResult<void, WorkspaceFileWriteTreeError>> {
    if (!this.files.writeTreeBatch) {
      throw new Error("Workspace authority does not support writeTreeBatch");
    }
    return writeTreeEntries(entries, (batch) => this.files.writeTreeBatch!(root, batch));
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCopyFileError>> {
    return this.files.read(path);
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCopyFileError>> {
    return this.files.list(path);
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCopyFileError>> {
    return this.files.stat(path);
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceCopyFileError>> {
    return this.files.delete(path);
  }

  async attach(host: WorkspaceFileMountHost, path: string): Promise<BetterResult<WorkspaceFileMount, WorkspaceFileMountError>> {
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
  constructor(private readonly authority: WorkspaceAuthority<WorkspaceCurrentFileError, WorkspaceCopyError, WorkspaceCopyLookupError, WorkspaceCopyFileError, WorkspaceApplyError, WorkspaceDiscardError>) {}

  async copy(name?: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>> {
    const copy = await this.authority.createCopy(name);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    return Result.ok(new WorkspaceFileCopy(copy.value));
  }

  async getCopy(id: string): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyLookupError>> {
    const copy = await this.authority.getCopy(id);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    return Result.ok(new WorkspaceFileCopy(copy.value));
  }

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceCurrentFileError>> {
    return this.authority.files.mkdir(path);
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCurrentFileError>> {
    return this.authority.files.write(path, contents);
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCurrentFileError>> {
    return this.authority.files.read(path);
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCurrentFileError>> {
    return this.authority.files.list(path);
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCurrentFileError>> {
    return this.authority.files.stat(path);
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceCurrentFileError>> {
    return this.authority.files.delete(path);
  }
}

function arrayOf(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
