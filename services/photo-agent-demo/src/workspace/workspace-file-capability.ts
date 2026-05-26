import { WorkerEntrypoint } from "cloudflare:workers";

import {
  createWorkspaceFileCapability,
  type ScopedWorkspaceRpcResult,
} from "../../../control-plane/src/workspace/scoped-file-capability";
import { disposeRpcResult } from "./rpc-disposal";

export type WorkspaceFileCapabilityProps = {
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
    useCapability: (workspace: ReturnType<typeof createWorkspaceFileCapability>) => Promise<ScopedWorkspaceRpcResult<T>>,
  ): Promise<T> {
    const workspace = this.env.WORKSPACES.getByName(this.ctx.props.workspaceName);
    const sessionResult = await workspace.getSession(this.ctx.props.draftEditId);
    try {
      if (sessionResult.status === "error") {
        throw new Error(`draft edit not found: ${sessionResult.error.tag}`);
      }

      const capability = createWorkspaceFileCapability({
        workingCopy: sessionResult.value!,
        root: "/",
        read: ["/photos/**"],
        write: ["/photos/**", "/notes/**"],
      });
      return unwrapScopedResult(await useCapability(capability));
    } finally {
      disposeRpcResult(sessionResult);
    }
  }
}

export function unwrapScopedResult<T>(result: ScopedWorkspaceRpcResult<T>): T {
  if (result.status === "error") {
    throw new Error(result.error.message ?? result.error.tag);
  }

  return (result as { status: "ok"; value?: T }).value as T;
}
