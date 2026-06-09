import type { Result as BetterResult } from "better-result";
import type { ArtifactsRepositoryResult } from "./artifacts/binding";

export type WorkspaceArtifactsRepository = Partial<Pick<ArtifactsRepositoryResult, "remote" | "defaultBranch">>;

export type ConnectArtifactsRepositoryOptions = {
  repository: WorkspaceArtifactsRepository;
  defaultBranch?: string;
};

export type WorkspaceArtifactsRepositoryAccessError = {
  tag: "WorkspaceArtifactsRepositoryAccessError";
  message: string;
};

type ConnectArtifactsRepository = <T extends object>(
  options: ConnectArtifactsRepositoryOptions,
) => Promise<BetterResult<T, WorkspaceArtifactsRepositoryAccessError>>;

const workspaceConnectors = new WeakMap<object, ConnectArtifactsRepository>();

export function registerWorkspaceSourceAdapterConnector<T extends object>(
  workspace: T,
  connect: (options: ConnectArtifactsRepositoryOptions) => Promise<BetterResult<T, WorkspaceArtifactsRepositoryAccessError>>,
): void {
  workspaceConnectors.set(workspace, connect as ConnectArtifactsRepository);
}

export function workspaceSourceAdapterConnector<T extends object>(
  workspace: T,
): ((options: ConnectArtifactsRepositoryOptions) => Promise<BetterResult<T, WorkspaceArtifactsRepositoryAccessError>>) | undefined {
  return workspaceConnectors.get(workspace) as ((options: ConnectArtifactsRepositoryOptions) => Promise<BetterResult<T, WorkspaceArtifactsRepositoryAccessError>>) | undefined;
}
