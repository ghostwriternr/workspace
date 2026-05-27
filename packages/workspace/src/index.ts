// Runtime exports used by Workers bindings. Product-facing helpers should avoid
// forcing ordinary app code to import runtime classes just to work with files.
export {
  Workspace,
  WorkspaceFileCopy,
  type WorkspaceApplyError,
  type WorkspaceCopyError,
  type WorkspaceCopyFiles,
  type WorkspaceCopyLookupError,
  type WorkspaceCurrentFiles,
  type WorkspaceDiscardError,
  type WorkspaceFileError,
  type WorkspaceFilesApi,
  type WorkspaceNamespace,
} from "./workspace/product/workspace";
export { WorkspaceObject } from "./workspace/runtime/workspace-object";
export { WorkspaceSession } from "./workspace/runtime/workspace-session";
export {
  attachWorkspaceMount,
  MountPathEscapeError,
  UnsupportedMountEntryError,
  type HostMountEntry,
  type WorkspaceMount,
  type WorkspaceMountError,
  type WorkspaceMountFlushSummary,
  type WorkspaceMountHost,
  type WorkspaceMountStat,
  type WorkspaceMountWorkingCopy,
} from "./workspace/projections/working-copy-mount";
export {
  createWorkspaceFileCapability,
  type ScopedWorkspaceAccessErrorDto,
  type ScopedWorkspaceErrorDto,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceOperationErrorDto,
  type ScopedWorkspacePathErrorDto,
  type ScopedWorkspaceRpcResult,
  type WorkspaceFileWorkingCopy,
} from "./workspace/projections/scoped-file-capability";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
