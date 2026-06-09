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
  WorkspaceCopyCreateError as WorkspaceCopyCreateDomainError,
  WorkspaceCopyFileError as WorkspaceCopyFileDomainError,
  WorkspaceCopyLookupError as WorkspaceCopyLookupDomainError,
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

export type WorkspaceCurrentFiles = WorkspaceCurrentFilesApi;

export type WorkspaceCopyCreateOptions = {
  label?: string;
};

export type WorkspaceCopies = {
  create(options?: WorkspaceCopyCreateOptions): Promise<BetterResult<WorkspaceCopy, WorkspaceCopyCreateError>>;
  get(id: string): Promise<BetterResult<WorkspaceCopy, WorkspaceCopyLookupError>>;
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

export type WorkspaceCopyFiles = WorkspaceCopyFilesApi & {
  writeTree(root: string, entries: WorkspaceTreeEntries): Promise<BetterResult<void, WorkspaceFileWriteTreeError>>;
  attach(host: WorkspaceFileMountHost, path: string): Promise<BetterResult<WorkspaceFileMount, WorkspaceFileMountError>>;
  scoped(options: WorkspaceFileScope): ScopedWorkspaceFileCapability;
};

export type WorkspaceCurrentFileError = ErrorDtoFor<
  WorkspaceMkdirError | WorkspaceWriteError | WorkspaceReadError | WorkspaceListError | WorkspaceStatError | WorkspaceDeleteError
>;

export type WorkspaceCopyFileError = ErrorDtoFor<WorkspaceCopyFileDomainError>;
export type WorkspaceCopyCreateError = ErrorDtoFor<WorkspaceCopyCreateDomainError>;
export type WorkspaceCopyLookupError = ErrorDtoFor<WorkspaceCopyLookupDomainError>;
export type WorkspaceApplyError = ErrorDtoFor<WorkspaceApplyDomainError>;
export type WorkspaceDiscardError = ErrorDtoFor<WorkspaceDiscardDomainError>;

export type WorkspaceObjectNamespace = {
  getByName(name: string): WorkspaceObjectClient;
};

export type WorkspaceBindingOptions = {
  artifacts: ArtifactsBindingClient;
  objects: WorkspaceObjectNamespace;
};

export type WorkspaceArtifactsRepository = {
  remote?: string;
  defaultBranch?: string;
};

export type WorkspaceAdoptArtifactsRepositoryToCurrentOptions = {
  repository: WorkspaceArtifactsRepository;
  defaultBranch?: string;
};

export type WorkspaceAdoptArtifactsRepositoryOptions = WorkspaceAdoptArtifactsRepositoryToCurrentOptions & {
  name: string;
};

export type WorkspaceArtifactsRepositoryAccessError = {
  tag: "WorkspaceArtifactsRepositoryAccessError";
  message: string;
};

export type WorkspaceBinding = {
  get(name: string): Workspace;
  adoptArtifactsRepository(
    options: WorkspaceAdoptArtifactsRepositoryOptions,
  ): Promise<BetterResult<Workspace, WorkspaceArtifactsRepositoryAccessError>>;
};

export class Workspace {
  static bind(options: WorkspaceBindingOptions): WorkspaceBinding {
    const get = (name: string): Workspace => {
      const object = options.objects.getByName(name);
      return new Workspace(
        name,
        createArtifactsWorkspaceAuthority({
          artifacts: options.artifacts,
          object,
          name,
        }),
        async (adoption: WorkspaceAdoptArtifactsRepositoryToCurrentOptions): Promise<BetterResult<Workspace, WorkspaceArtifactsRepositoryAccessError>> => {
          const access = artifactsRepositoryAccessFrom(adoption.repository, adoption.defaultBranch);
          if (!access) {
            return Result.err({
              tag: "WorkspaceArtifactsRepositoryAccessError",
              message: "Artifacts repository access metadata must include a remote URL.",
            });
          }

          await object.recordCurrentRepository({
            repository: name,
            ...access,
          });
          return Result.ok(get(name));
        },
      );
    };

    return {
      get,
      async adoptArtifactsRepository(
        adoption: WorkspaceAdoptArtifactsRepositoryOptions,
      ): Promise<BetterResult<Workspace, WorkspaceArtifactsRepositoryAccessError>> {
        return get(adoption.name).adoptArtifactsRepository({
          repository: adoption.repository,
          ...(adoption.defaultBranch ? { defaultBranch: adoption.defaultBranch } : {}),
        });
      },
    };
  }

  readonly files: WorkspaceCurrentFiles;
  readonly copies: WorkspaceCopies;

  private constructor(
    readonly name: string,
    private readonly authority: WorkspaceAuthority<WorkspaceCurrentFileError, WorkspaceCopyCreateError, WorkspaceCopyLookupError, WorkspaceCopyFileError, WorkspaceApplyError, WorkspaceDiscardError>,
    private readonly adoptArtifactsRepositoryToCurrent: (
      options: WorkspaceAdoptArtifactsRepositoryToCurrentOptions,
    ) => Promise<BetterResult<Workspace, WorkspaceArtifactsRepositoryAccessError>>,
  ) {
    this.files = new WorkspaceFiles(authority.files);
    this.copies = new WorkspaceCopiesApi(authority);
  }

  async adoptArtifactsRepository(
    options: WorkspaceAdoptArtifactsRepositoryToCurrentOptions,
  ): Promise<BetterResult<Workspace, WorkspaceArtifactsRepositoryAccessError>> {
    return this.adoptArtifactsRepositoryToCurrent(options);
  }
}

export class WorkspaceCopy {
  readonly files: WorkspaceCopyFiles;

  constructor(private readonly copy: WorkspaceAuthorityCopy<WorkspaceCopyFileError, WorkspaceApplyError, WorkspaceDiscardError>) {
    this.id = copy.id;
    this.label = copy.label;
    this.createdAt = copy.createdAt;
    this.files = new WorkspaceCopyFilesView(copy.files);
  }

  readonly id: string;
  readonly label?: string;
  readonly createdAt: number;

  async apply(): Promise<BetterResult<WorkspaceRevision, WorkspaceApplyError>> {
    return this.copy.apply();
  }

  async discard(): Promise<BetterResult<void, WorkspaceDiscardError>> {
    return this.copy.discard();
  }
}

class WorkspaceCopyFilesView implements WorkspaceCopyFiles {
  constructor(private readonly files: WorkspaceAuthorityFiles<WorkspaceCopyFileError>) {}

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceCopyFileError>> {
    return this.files.mkdir(path);
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCopyFileError>> {
    return this.files.write(path, contents);
  }

  async writeTree(root: string, entries: WorkspaceTreeEntries): Promise<BetterResult<void, WorkspaceFileWriteTreeError>> {
    const writeTreeBatch = this.files.writeTreeBatch;
    if (!writeTreeBatch) {
      throw new Error("Workspace authority does not support writeTreeBatch");
    }
    return writeTreeEntries(entries, (batch) => writeTreeBatch.call(this.files, root, batch));
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

class WorkspaceCopiesApi implements WorkspaceCopies {
  constructor(private readonly authority: WorkspaceAuthority<WorkspaceCurrentFileError, WorkspaceCopyCreateError, WorkspaceCopyLookupError, WorkspaceCopyFileError, WorkspaceApplyError, WorkspaceDiscardError>) {}

  async create(options: WorkspaceCopyCreateOptions = {}): Promise<BetterResult<WorkspaceCopy, WorkspaceCopyCreateError>> {
    const copy = await this.authority.createCopy(options.label);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    return Result.ok(new WorkspaceCopy(copy.value));
  }

  async get(id: string): Promise<BetterResult<WorkspaceCopy, WorkspaceCopyLookupError>> {
    const copy = await this.authority.getCopy(id);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    return Result.ok(new WorkspaceCopy(copy.value));
  }
}

class WorkspaceFiles implements WorkspaceCurrentFiles {
  constructor(private readonly files: WorkspaceAuthorityFiles<WorkspaceCurrentFileError>) {}

  async mkdir(path: string): Promise<BetterResult<void, WorkspaceCurrentFileError>> {
    return this.files.mkdir(path);
  }

  async write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCurrentFileError>> {
    return this.files.write(path, contents);
  }

  async read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCurrentFileError>> {
    return this.files.read(path);
  }

  async list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCurrentFileError>> {
    return this.files.list(path);
  }

  async stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCurrentFileError>> {
    return this.files.stat(path);
  }

  async delete(path: string): Promise<BetterResult<void, WorkspaceCurrentFileError>> {
    return this.files.delete(path);
  }
}

function arrayOf(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function artifactsRepositoryAccessFrom(
  repository: WorkspaceArtifactsRepository,
  fallbackDefaultBranch: string | undefined,
): { remote: string; defaultBranch: string } | undefined {
  if (!repository.remote) {
    return undefined;
  }

  const defaultBranch = fallbackDefaultBranch ?? repository.defaultBranch;
  if (!defaultBranch) {
    return undefined;
  }

  return {
    remote: repository.remote,
    defaultBranch,
  };
}
