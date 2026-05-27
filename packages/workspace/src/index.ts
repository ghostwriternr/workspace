// Runtime exports used by Workers bindings. Product-facing helpers should avoid
// forcing ordinary app code to import runtime classes just to work with files.
export {
  Workspace,
  WorkspaceFileCopy,
  type WorkspaceApplyError,
  type WorkspaceCopyError,
  type WorkspaceCopyLookupError,
  type WorkspaceCurrentFiles,
  type WorkspaceDiscardError,
  type WorkspaceFileCopyFiles,
  type WorkspaceFileError,
  type WorkspaceFileScope,
  type WorkspaceFilesApi,
  type WorkspaceNamespace,
} from "./workspace/product/workspace";
export {
  type WorkspaceFileAttachment,
  type WorkspaceFileAttachmentError,
  type WorkspaceFileAttachmentHost,
  type WorkspaceFileCaptureSummary,
} from "./workspace/product/attachment";
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
