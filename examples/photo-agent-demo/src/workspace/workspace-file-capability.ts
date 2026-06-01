import { Result } from "better-result";
import { Workspace, type ScopedWorkspaceFileCapability, type ScopedWorkspaceRpcResult } from "@cloudflare/workspace";
import { WorkspaceFileCapabilityEntrypoint } from "@cloudflare/workspace-adapter-dynamic-worker";

type WorkspaceFileCapabilityProps = {
  workspaceName: string;
  draftEditId: string;
};

export class WorkspaceFileCapability extends WorkspaceFileCapabilityEntrypoint<Env, WorkspaceFileCapabilityProps> {
  protected async getWorkspaceFileCapability(): Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>> {
    const workspace = Workspace.get(this.env.WORKSPACES, this.ctx.props.workspaceName);
    const copy = await workspace.files.getCopy(this.ctx.props.draftEditId);
    if (Result.isError(copy)) {
      return {
        status: "error",
        error: {
          tag: copy.error.tag,
          message: copy.error.message ?? `draft edit not found: ${copy.error.tag}`,
        },
      };
    }

    return {
      status: "ok",
      value: copy.value.files.scoped({
        read: ["/photos/**"],
        write: ["/photos/**", "/notes/**"],
      }),
    };
  }
}
