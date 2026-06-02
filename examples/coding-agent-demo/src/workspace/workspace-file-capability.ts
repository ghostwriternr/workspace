import { Result } from "better-result";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  Workspace,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceRpcResult,
  type WorkspaceEntry,
  type WorkspaceStat,
} from "@cloudflare/workspace";
import { normalizeAgentPath } from "../agent/path";

type WorkspaceFileCapabilityProps = {
  workspaceName: string;
  editCopyId: string;
};

export class WorkspaceFileCapability extends WorkerEntrypoint<Env, WorkspaceFileCapabilityProps> implements ScopedWorkspaceFileCapability {
  private capability?: ScopedWorkspaceFileCapability;
  private capabilityPromise?: Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>>;

  async readFile(path: string): Promise<ScopedWorkspaceRpcResult<Uint8Array>> {
    return this.withCapability((workspace) => workspace.readFile(normalizeAgentPath(path)));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<ScopedWorkspaceRpcResult> {
    return this.withCapability((workspace) => workspace.writeFile(normalizeAgentPath(path), contents));
  }

  async list(path: string): Promise<ScopedWorkspaceRpcResult<WorkspaceEntry[]>> {
    return this.withCapability((workspace) => workspace.list(normalizeAgentPath(path)));
  }

  async stat(path: string): Promise<ScopedWorkspaceRpcResult<WorkspaceStat>> {
    return this.withCapability((workspace) => workspace.stat(normalizeAgentPath(path)));
  }

  private async withCapability<T>(
    useCapability: (workspace: ScopedWorkspaceFileCapability) => Promise<ScopedWorkspaceRpcResult<T>>,
  ): Promise<ScopedWorkspaceRpcResult<T>> {
    const capability = await this.getWorkspaceFileCapability();
    if (capability.status === "error") {
      return capability;
    }

    return useCapability(capability.value);
  }

  private async getWorkspaceFileCapability(): Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>> {
    if (this.capability) {
      return { status: "ok", value: this.capability };
    }

    this.capabilityPromise ??= this.createWorkspaceFileCapability();
    const capability = await this.capabilityPromise;
    if (capability.status === "error") {
      this.capabilityPromise = undefined;
      return capability;
    }

    this.capability = capability.value;
    return capability;
  }

  private async createWorkspaceFileCapability(): Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>> {
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

    return {
      status: "ok",
      value: copy.value.files.scoped({
        read: ["/**"],
        write: ["/**"],
      }),
    };
  }
}
