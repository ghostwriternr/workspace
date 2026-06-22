import { Result } from "better-result";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  Workspace,
  type ScopedWorkspaceCapabilityResult,
  type ScopedWorkspaceFileCapability,
  type WorkspaceEntry,
  type WorkspaceStat,
} from "@cloudflare/workspace";

type WorkspaceFileCapabilityProps = {
  workspaceName: string;
  workingCopyId: string;
};

export class WorkspaceFileCapability extends WorkerEntrypoint<Env, WorkspaceFileCapabilityProps> implements ScopedWorkspaceFileCapability {
  private capability?: ScopedWorkspaceFileCapability;
  private capabilityPromise?: Promise<ScopedWorkspaceCapabilityResult<ScopedWorkspaceFileCapability>>;

  async readFile(path: string): Promise<ScopedWorkspaceCapabilityResult<Uint8Array>> {
    return this.withCapability((workspace) => workspace.readFile(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<ScopedWorkspaceCapabilityResult> {
    return this.withCapability((workspace) => workspace.writeFile(path, contents));
  }

  async list(path: string): Promise<ScopedWorkspaceCapabilityResult<WorkspaceEntry[]>> {
    return this.withCapability((workspace) => workspace.list(path));
  }

  async stat(path: string): Promise<ScopedWorkspaceCapabilityResult<WorkspaceStat>> {
    return this.withCapability((workspace) => workspace.stat(path));
  }

  private async withCapability<T>(
    useCapability: (workspace: ScopedWorkspaceFileCapability) => Promise<ScopedWorkspaceCapabilityResult<T>>,
  ): Promise<ScopedWorkspaceCapabilityResult<T>> {
    const capability = await this.getWorkspaceFileCapability();
    if (capability.status === "error") {
      return capability;
    }

    return useCapability(capability.value);
  }

  private async getWorkspaceFileCapability(): Promise<ScopedWorkspaceCapabilityResult<ScopedWorkspaceFileCapability>> {
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

  private async createWorkspaceFileCapability(): Promise<ScopedWorkspaceCapabilityResult<ScopedWorkspaceFileCapability>> {
    const workspace = Workspace.bind({
      artifacts: this.env.ARTIFACTS,
      objects: this.env.WORKSPACE_OBJECTS,
    }).get(this.ctx.props.workspaceName);
    const copy = await workspace.copies.get(this.ctx.props.workingCopyId);
    if (Result.isError(copy)) {
      return {
        status: "error",
        error: {
          tag: copy.error.tag,
          message: copy.error.message ?? `working copy not found: ${copy.error.tag}`,
        },
      };
    }

    return {
      status: "ok",
      value: copy.value.files.scoped({ read: ["/**"], write: ["/**"] }),
    };
  }
}
