import { Result, type Result as BetterResult } from "better-result";
import type { WorkspaceBinding } from "@cloudflare/workspace";
import type { GitHubImportError, GitHubImportSummary, GitHubSource } from "@cloudflare/workspace-source-github";

export type RepoImportRequest = {
  workspaceName: string;
  owner: string;
  repo: string;
  ref?: string;
  root?: string;
};

export type RepoImportSummary = GitHubImportSummary & {
  root: string;
};

export type RepoImportError = GitHubImportError;

export type RepoImportControllerDependencies = {
  workspaces: WorkspaceBinding;
  github: GitHubSource;
};

export class RepoImportController {
  constructor(private readonly dependencies: RepoImportControllerDependencies) {}

  async importGitHubRepo(request: RepoImportRequest): Promise<BetterResult<RepoImportSummary, RepoImportError>> {
    const imported = await this.dependencies.github.importRepository({
      workspace: this.dependencies.workspaces.get(request.workspaceName),
      owner: request.owner,
      repo: request.repo,
      ...(request.ref ? { ref: request.ref } : {}),
    });

    if (Result.isError(imported)) {
      return Result.err(imported.error);
    }

    return Result.ok({
      ...imported.value,
      root: request.root ?? "/",
    });
  }
}
