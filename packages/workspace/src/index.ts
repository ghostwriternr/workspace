// Runtime exports used by Workers bindings. Product-facing helpers should avoid
// forcing ordinary app code to import runtime classes just to work with files.
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
  type WorkspaceNamespace,
} from "./workspace/product/workspace";
export { type WorkspaceEntry, type WorkspaceStat } from "./workspace/model/rpc";
export { type WorkspaceTreeEntry } from "./workspace/model/write-tree";
export {
  type WorkspaceFileMount,
  type WorkspaceFileMountError,
  type WorkspaceFileMountHost,
  type WorkspaceFileMountHostEntry,
  type WorkspaceFileReconcileSummary,
} from "./workspace/product/mount";
export { WorkspaceObject } from "./workspace/runtime/workspace-object";
export {
  type ScopedWorkspaceAccessErrorDto,
  type ScopedWorkspaceErrorDto,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceOperationErrorDto,
  type ScopedWorkspacePathErrorDto,
  type ScopedWorkspaceRpcResult,
} from "./workspace/projections/scoped-file-capability";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
