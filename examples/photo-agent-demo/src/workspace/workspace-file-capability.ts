import { Result } from "better-result";
import { WorkerEntrypoint } from "cloudflare:workers";

// This loopback entrypoint adapts a product-level scoped file capability into a
// Dynamic Worker binding. It is transport glue, not photo product logic.
import {
  Workspace,
  type ScopedWorkspaceFileCapability,
  type ScopedWorkspaceRpcResult,
} from "@cloudflare/workspace";

type WorkspaceFileCapabilityProps = {
  workspaceName: string;
  draftEditId: string;
};

export type DynamicWorkerWorkspaceBinding = {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  list(path: string): Promise<Array<{ name: string; path: string; type: "directory" | "file" }>>;
  stat(path: string): Promise<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }>;
};

export type DynamicWorkerWorkspaceBindingFactory = {
  bindingForDraft(draftEditId: string): DynamicWorkerWorkspaceBinding;
};

export class WorkspaceFileCapability extends WorkerEntrypoint<Env, WorkspaceFileCapabilityProps> implements DynamicWorkerWorkspaceBinding {
  private capability?: ScopedWorkspaceFileCapability;

  async readFile(path: string): Promise<Uint8Array> {
    return this.withCapability((workspace) => workspace.readFile(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    await this.withCapability((workspace) => workspace.writeFile(path, contents));
  }

  async list(path: string): Promise<Array<{ name: string; path: string; type: "directory" | "file" }>> {
    return this.withCapability((workspace) => workspace.list(path));
  }

  async stat(path: string): Promise<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }> {
    return this.withCapability((workspace) => workspace.stat(path));
  }

  private async withCapability<T>(
    useCapability: (workspace: ScopedWorkspaceFileCapability) => Promise<ScopedWorkspaceRpcResult<T>>,
  ): Promise<T> {
    this.capability ??= await this.createCapability();
    return unwrapScopedResult(await useCapability(this.capability));
  }

  private async createCapability(): Promise<ScopedWorkspaceFileCapability> {
    const workspace = Workspace.get(this.env.WORKSPACES, this.ctx.props.workspaceName);
    const copy = await workspace.files.getCopy(this.ctx.props.draftEditId);
    if (Result.isError(copy)) {
      throw new Error(`draft edit not found: ${copy.error.tag}`);
    }

    return copy.value.files.scoped({
      read: ["/photos/**"],
      write: ["/photos/**", "/notes/**"],
    });
  }
}

function unwrapScopedResult<T>(result: ScopedWorkspaceRpcResult<T>): T {
  if (result.status === "error") {
    throw new Error(result.error.message ?? result.error.tag);
  }

  return (result as { status: "ok"; value?: T }).value as T;
}
