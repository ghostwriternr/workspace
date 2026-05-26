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
  type WorkspaceMountWorkingCopy,
} from "./workspace/working-copy-mount";

export default {
  fetch(): Response {
    return new Response("Not found", { status: 404 });
  },
};
