import type { Result as BetterResult } from "better-result";
import type { WorkspaceEntry, WorkspaceRevision, WorkspaceStat } from "./model/entries";
import type { WorkspaceTreeEntry } from "./model/write-tree";
import type { WorkspaceRuntimeMountDescriptor, WorkspaceRuntimeMountError } from "./runtime-adapter";

export type WorkspaceAuthorityFiles<FileError> = {
  mkdir(path: string): Promise<BetterResult<void, FileError>>;
  write(path: string, contents: Uint8Array): Promise<BetterResult<void, FileError>>;
  writeTreeBatch?(root: string, entries: WorkspaceTreeEntry[]): Promise<BetterResult<void, FileError>>;
  read(path: string): Promise<BetterResult<Uint8Array, FileError>>;
  list(path: string): Promise<BetterResult<WorkspaceEntry[], FileError>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, FileError>>;
  delete(path: string): Promise<BetterResult<void, FileError>>;
};

export type WorkspaceAuthorityCopy<CopyFileError, ApplyError, DiscardError> = {
  id: string;
  label?: string;
  createdAt: number;
  files: WorkspaceAuthorityFiles<CopyFileError>;
  runtimeMount?(): Promise<BetterResult<WorkspaceRuntimeMountDescriptor, WorkspaceRuntimeMountError>>;
  apply(): Promise<BetterResult<WorkspaceRevision, ApplyError>>;
  discard(): Promise<BetterResult<void, DiscardError>>;
};

export type WorkspaceAuthority<CurrentFileError, CopyError, CopyLookupError, CopyFileError, ApplyError, DiscardError> = {
  files: WorkspaceAuthorityFiles<CurrentFileError>;
  createCopy(label?: string): Promise<BetterResult<WorkspaceAuthorityCopy<CopyFileError, ApplyError, DiscardError>, CopyError>>;
  getCopy(id: string): Promise<BetterResult<WorkspaceAuthorityCopy<CopyFileError, ApplyError, DiscardError>, CopyLookupError>>;
};
