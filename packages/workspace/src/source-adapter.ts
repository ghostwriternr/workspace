import { Result, type Result as BetterResult } from "better-result";
import type { ArtifactsImportBindingClient, ArtifactsRepositoryResult } from "./artifacts/binding";
import type { Workspace } from "./workspace";
import {
  workspaceSourceAdapterConnector,
  type ConnectArtifactsRepositoryOptions,
  type WorkspaceArtifactsRepository,
  type WorkspaceArtifactsRepositoryAccessError,
} from "./source-adapter-registry";

export type {
  ArtifactsImportBindingClient,
  ArtifactsRepositoryResult,
  ConnectArtifactsRepositoryOptions,
  WorkspaceArtifactsRepository,
  WorkspaceArtifactsRepositoryAccessError,
};

export function connectArtifactsRepository(
  workspace: Workspace,
  options: ConnectArtifactsRepositoryOptions,
): Promise<BetterResult<Workspace, WorkspaceArtifactsRepositoryAccessError>> {
  const connect = workspaceSourceAdapterConnector(workspace);
  if (!connect) {
    return Promise.resolve(Result.err({
      tag: "WorkspaceArtifactsRepositoryAccessError",
      message: "Workspace does not support Artifacts repository connection.",
    }));
  }

  return connect(options);
}
