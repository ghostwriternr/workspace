import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  ScopedWorkspaceFileCapability,
  ScopedWorkspaceRpcResult,
  WorkspaceEntry,
  WorkspaceStat,
} from "@cloudflare/workspace";

export abstract class WorkspaceFileCapabilityEntrypoint<Env, Props>
  extends WorkerEntrypoint<Env, Props>
  implements ScopedWorkspaceFileCapability {
  private capability?: ScopedWorkspaceFileCapability;
  private capabilityPromise?: Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>>;

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

  protected abstract getWorkspaceFileCapability(): Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>>;

  private async withCapability<T>(
    useCapability: (workspace: ScopedWorkspaceFileCapability) => Promise<ScopedWorkspaceRpcResult<T>>,
  ): Promise<ScopedWorkspaceRpcResult<T>> {
    const capability = await this.cachedCapability();
    if (capability.status === "error") {
      return capability;
    }

    return useCapability(capability.value);
  }

  private async cachedCapability(): Promise<ScopedWorkspaceRpcResult<ScopedWorkspaceFileCapability>> {
    if (this.capability) {
      return { status: "ok", value: this.capability };
    }

    this.capabilityPromise ??= this.getWorkspaceFileCapability();
    const capability = await this.capabilityPromise;
    if (capability.status === "error") {
      this.capabilityPromise = undefined;
      return capability;
    }

    this.capability = capability.value;
    return capability;
  }
}
