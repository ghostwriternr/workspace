// Runtime exports used by Workers bindings. File helpers should avoid forcing
// ordinary app code to import runtime classes just to work with files.
export {
  Workspace,
  WorkspaceFileCopy,
  type WorkspaceApplyError,
  type WorkspaceCopyError,
  type WorkspaceCopyFileError,
  type WorkspaceCopyLookupError,
  type WorkspaceCopyFilesApi,
  type WorkspaceCurrentFileError,
  type WorkspaceCurrentFiles,
  type WorkspaceCurrentFilesApi,
  type WorkspaceDiscardError,
  type WorkspaceFileCopyFiles,
  type WorkspaceFilesApi,
  type WorkspaceFileScope,
  type WorkspaceFileWriteTreeError,
  type WorkspaceTreeEntries,
  type WorkspaceTreeEntryTooLargeError,
  type WorkspaceTreeSourceError,
} from "./workspace";
export { type WorkspaceEntry, type WorkspaceRevision, type WorkspaceStat } from "./model/entries";
export type {
  WorkspaceObject,
  WorkspaceCopyRepositoryRecord,
  WorkspaceCurrentRepositoryRecord,
  WorkspaceObjectClient,
  WorkspaceRepositoryAccess,
} from "./workspace-object";
export { type WorkspaceTreeEntry } from "./model/write-tree";
export {
  type WorkspaceFileMount,
  type WorkspaceFileMountError,
  type WorkspaceFileMountHost,
  type WorkspaceFileMountHostEntry,
  type WorkspaceFileReconcileSummary,
} from "./mount";
export {
  type ScopedWorkspaceAccessErrorDto,
  type ScopedWorkspaceErrorDto,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceOperationErrorDto,
  type ScopedWorkspacePathErrorDto,
  type ScopedWorkspaceCapabilityResult,
} from "./projections/scoped-file-capability";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
