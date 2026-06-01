import { Result, type Result as BetterResult } from "better-result";
import {
  Workspace,
  type WorkspaceApplyError,
  type WorkspaceCopyError,
  type WorkspaceDiscardError,
  type WorkspaceFileWriteTreeError,
  type WorkspaceNamespace,
} from "@cloudflare/workspace";
import {
  resolveGitHubSource,
  type GitHubSource,
  type GitHubSourceOptions,
  type GitHubSourceResolveError,
  type GitHubSourceSnapshot,
} from "@cloudflare/workspace-source-github";

export type RepoImportRequest = {
  workspaceName: string;
  owner: string;
  repo: string;
  ref?: string;
  root?: string;
};

export type RepoImportSummary = {
  workspaceName: string;
  root: string;
  source: GitHubSourceSnapshot;
  revisionId: string;
  createdAt: number;
};

export type RepoImportError =
  | GitHubSourceResolveError
  | WorkspaceCopyError
  | WorkspaceFileWriteTreeError
  | WorkspaceApplyError
  | WorkspaceDiscardError;

export type GitHubSourceResolver = (options: GitHubSourceOptions) => Promise<BetterResult<GitHubSource, GitHubSourceResolveError>>;

export type RepoImportControllerDependencies = {
  workspaces: WorkspaceNamespace;
  resolveSource?: GitHubSourceResolver;
};

export class RepoImportController {
  private readonly resolveSource: GitHubSourceResolver;

  constructor(private readonly dependencies: RepoImportControllerDependencies) {
    this.resolveSource = dependencies.resolveSource ?? resolveGitHubSource;
  }

  async importGitHubRepo(request: RepoImportRequest): Promise<BetterResult<RepoImportSummary, RepoImportError>> {
    const source = await this.resolveSource({
      owner: request.owner,
      repo: request.repo,
      ref: request.ref,
    });
    if (Result.isError(source)) {
      return Result.err(source.error);
    }

    const workspace = Workspace.get(this.dependencies.workspaces, request.workspaceName);
    const copy = await workspace.files.copy("github-import");
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const root = request.root ?? "/";
    const writeTree = await copy.value.files.writeTree(root, source.value.entries());
    if (Result.isError(writeTree)) {
      const discard = await copy.value.discard();
      if (Result.isError(discard)) {
        return Result.err(discard.error);
      }
      return Result.err(writeTree.error);
    }

    const apply = await copy.value.apply();
    if (Result.isError(apply)) {
      await copy.value.discard();
      return Result.err(apply.error);
    }

    return Result.ok({
      workspaceName: request.workspaceName,
      root,
      source: source.value.snapshot,
      revisionId: apply.value.revisionId,
      createdAt: apply.value.createdAt,
    });
  }
}
