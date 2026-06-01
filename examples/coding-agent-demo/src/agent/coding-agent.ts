import { Agent, callable } from "agents";

import { RepoEditController } from "../repo/edit-controller";
import { RepoStateController } from "../repo/state-controller";
import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";
import type { RepoImportSummary } from "../repo/import-controller";

export type CodingAgentState = {
  lastImport?: RepoImportSummary;
  editCopyId?: string;
};

export class CodingAgent extends Agent<Env, CodingAgentState> {
  static readonly actions = ["listRepoState", "runDynamicWorker"] as const;

  initialState: CodingAgentState = {};

  @callable()
  async listRepoState() {
    return this.refreshRepoState();
  }

  @callable()
  async runDynamicWorker({ code }: { code: string }) {
    const result = await new RepoEditController({
      workspaces: this.env.WORKSPACES,
      workspaceName: this.name,
      dynamicWorkerRunner: createWorkspaceDynamicWorkerRunner(this.env.DYNAMIC_WORKERS),
      workspaceForEdit: (editCopyId) => this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName: this.name, editCopyId } }),
      getEditCopyId: () => this.state.editCopyId,
      setEditCopyId: (editCopyId) => this.setState({ ...this.state, editCopyId }),
    }).runDynamicWorker({ code });

    await this.refreshRepoState();
    return resultToRpc(result);
  }

  @callable()
  async refreshRepoState(lastImport?: RepoImportSummary) {
    const repo = await new RepoStateController({
      workspaces: this.env.WORKSPACES,
      workspaceName: this.name,
      editCopyId: this.state.editCopyId,
    }).listRepoState();

    if (lastImport) {
      this.setState({ ...this.state, lastImport });
    }
    return resultToRpc(repo);
  }
}

function resultToRpc<T, E>(result: { status: "ok"; value: T } | { status: "error"; error: E }): { status: "ok"; value: T } | { status: "error"; error: E } {
  if (result.status === "error") {
    return { status: "error", error: result.error };
  }
  return { status: "ok", value: result.value };
}
