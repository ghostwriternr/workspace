import { Agent, callable } from "agents";

import { RepoEditController } from "../repo/edit-controller";
import { RepoStateController, type RepoState } from "../repo/state-controller";
import { createDynamicWorkerRunner } from "../workspace/dynamic-worker-runner";
import type { RepoImportSummary } from "../repo/import-controller";

export type CodingAgentState = {
  lastImport?: RepoImportSummary;
  repo?: RepoState;
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
      dynamicWorkerRunner: createDynamicWorkerRunner(this.env.DYNAMIC_WORKERS, {
        bindingForEdit: (editCopyId) => this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName: this.name, editCopyId } }),
      }),
      getEditCopyId: () => this.state.editCopyId,
      setEditCopyId: (editCopyId) => this.setState({ ...this.state, editCopyId }),
    }).runDynamicWorker({ code });

    await this.refreshRepoState();
    return result;
  }

  @callable()
  async refreshRepoState(lastImport?: RepoImportSummary) {
    const repo = await new RepoStateController({
      workspaces: this.env.WORKSPACES,
      workspaceName: this.name,
      editCopyId: this.state.editCopyId,
    }).listRepoState();

    const nextState = {
      ...this.state,
      repo,
      lastImport: lastImport ?? this.state.lastImport,
    };
    this.setState(nextState);
    return repo;
  }
}
