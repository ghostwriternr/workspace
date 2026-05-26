export { WorkspaceObject } from "./workspace/workspace-object";
export { WorkspaceSession } from "./workspace/workspace-session";
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
} from "./workspace/working-copy-mount";
export {
  createWorkspaceFileCapability,
  type ScopedWorkspaceAccessErrorDto,
  type ScopedWorkspaceErrorDto,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceOperationErrorDto,
  type ScopedWorkspacePathErrorDto,
  type ScopedWorkspaceRpcResult,
  type WorkspaceFileWorkingCopy,
} from "./workspace/scoped-file-capability";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
