import { Agent, callable } from "agents";

import { RepoStateController, type RepoState } from "../repo/state-controller";
import type { RepoImportSummary } from "../repo/import-controller";

export type CodingAgentState = {
  lastImport?: RepoImportSummary;
  repo?: RepoState;
};

export class CodingAgent extends Agent<Env, CodingAgentState> {
  static readonly actions = ["listRepoState"] as const;

  initialState: CodingAgentState = {};

  @callable()
  async listRepoState() {
    return this.refreshRepoState();
  }

  @callable()
  async refreshRepoState(lastImport?: RepoImportSummary) {
    const repo = await new RepoStateController({
      workspaces: this.env.WORKSPACES,
      workspaceName: this.name,
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
