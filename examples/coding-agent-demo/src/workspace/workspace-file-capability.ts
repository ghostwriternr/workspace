import { Result } from "better-result";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  Workspace,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceRpcResult,
  type WorkspaceEntry,
  type WorkspaceStat,
} from "@cloudflare/workspace";

type WorkspaceFileCapabilityProps = {
  workspaceName: string;
  editCopyId: string;
};

export type DynamicWorkerWorkspaceBinding = ScopedWorkspaceFileCapability;

export type DynamicWorkerWorkspaceBindingFactory = {
  bindingForEdit(editCopyId: string): DynamicWorkerWorkspaceBinding;
};

export class WorkspaceFileCapability extends WorkerEntrypoint<Env, WorkspaceFileCapabilityProps> implements DynamicWorkerWorkspaceBinding {
  private capability?: ScopedWorkspaceFileCapability;

  async readFile(path: string): Promise<ScopedWorkspaceRpcResult<Uint8Array>> {
    return this.withCapability((workspace) => workspace.readFile(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<ScopedWorkspaceRpcResult> {
    return this.withCapability((workspace) => workspace.writeFile(path, contents));
  }

  async list(path: string): Promise<ScopedWorkspaceRpcResult<WorkspaceEntry[]>> {
    return this.withCapability((workspace) => workspace.list(path));
  }

  async stat(path: string): Promise<ScopedWorkspaceRpcResult<WorkspaceStat>> {
    return this.withCapability((workspace) => workspace.stat(path));
  }

  private async withCapability<T>(
    useCapability: (workspace: ScopedWorkspaceFileCapability) => Promise<ScopedWorkspaceRpcResult<T>>,
  ): Promise<ScopedWorkspaceRpcResult<T>> {
    const capability = await this.getCapability();
    if (capability.status === "error") {
      return capability;
    }

    return useCapability(capability.value);
  }

  private async getCapability(): Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>> {
    if (this.capability) {
      return { status: "ok", value: this.capability };
    }

    const workspace = Workspace.get(this.env.WORKSPACES, this.ctx.props.workspaceName);
    const copy = await workspace.files.getCopy(this.ctx.props.editCopyId);
    if (Result.isError(copy)) {
      return {
        status: "error",
        error: {
          tag: copy.error.tag,
          message: copy.error.message ?? `edit copy not found: ${copy.error.tag}`,
        },
      };
    }

    this.capability = copy.value.files.scoped({
      read: ["/**"],
      write: ["/**"],
    });
    return { status: "ok", value: this.capability };
  }
}
