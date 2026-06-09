import { Result, type Result as BetterResult } from "better-result";
import type {
  ArtifactsImportBindingClient,
  ArtifactsRepositoryResult,
  Workspace,
} from "@cloudflare/workspace";

type SourceArtifactsBinding = ArtifactsImportBindingClient;
type SourceArtifactsImportResult = ArtifactsRepositoryResult;

export type GitHubSourceOptions = {
  artifacts: SourceArtifactsBinding;
};

export type GitHubImportRepositoryOptions = {
  workspace: Workspace;
  owner: string;
  repo: string;
  ref?: string;
};

export type GitHubImportSummary = {
  workspaceName: string;
  importedAt: number;
  source: {
    adapter: "github";
    host: "github.com";
    owner: string;
    repo: string;
    requestedRef?: string;
  };
};

export type InvalidGitHubRepositoryError = {
  tag: "InvalidGitHubRepositoryError";
  message: string;
};

export type GitHubSourceImportError = {
  tag: "GitHubSourceImportError";
  message: string;
  code?: string;
};

export type GitHubWorkspaceConnectionError = {
  tag: "GitHubWorkspaceConnectionError";
  message: string;
};

export type GitHubImportError =
  | InvalidGitHubRepositoryError
  | GitHubSourceImportError
  | GitHubWorkspaceConnectionError;

export type GitHubSource = {
  importRepository(options: GitHubImportRepositoryOptions): Promise<BetterResult<GitHubImportSummary, GitHubImportError>>;
};

export function createGitHubSource(options: GitHubSourceOptions): GitHubSource {
  return new DefaultGitHubSource(options.artifacts);
}

class DefaultGitHubSource implements GitHubSource {
  constructor(private readonly artifacts: SourceArtifactsBinding) {}

  async importRepository(options: GitHubImportRepositoryOptions): Promise<BetterResult<GitHubImportSummary, GitHubImportError>> {
    const valid = validateRepository(options.owner, options.repo);
    if (Result.isError(valid)) {
      return Result.err(valid.error);
    }

    let imported: SourceArtifactsImportResult;
    try {
      imported = await this.artifacts.import({
        source: {
          url: `https://github.com/${options.owner}/${options.repo}.git`,
          ...(options.ref ? { branch: options.ref } : {}),
          depth: 1,
        },
        target: {
          name: options.workspace.name,
          opts: {
            description: `Imported from github.com/${options.owner}/${options.repo}`,
          },
        },
      });
    } catch (error) {
      return Result.err(artifactsImportError(error));
    }

    const adopted = await options.workspace.adoptArtifactsRepository({
      repository: imported,
      ...(options.ref ? { defaultBranch: options.ref } : {}),
    });
    if (Result.isError(adopted)) {
      return Result.err({
        tag: "GitHubWorkspaceConnectionError",
        message: adopted.error.message,
      });
    }

    return Result.ok({
      workspaceName: options.workspace.name,
      importedAt: Date.now(),
      source: {
        adapter: "github",
        host: "github.com",
        owner: options.owner,
        repo: options.repo,
        ...(options.ref ? { requestedRef: options.ref } : {}),
      },
    });
  }
}

function validateRepository(owner: string, repo: string): BetterResult<void, InvalidGitHubRepositoryError> {
  if (!isValidOwner(owner)) {
    return Result.err({
      tag: "InvalidGitHubRepositoryError",
      message: "GitHub owner must be a valid repository owner name.",
    });
  }
  if (!isValidRepo(repo)) {
    return Result.err({
      tag: "InvalidGitHubRepositoryError",
      message: "GitHub repo must be a valid repository name.",
    });
  }
  return Result.ok(undefined);
}

function isValidOwner(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

function isValidRepo(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}

function artifactsImportError(error: unknown): GitHubSourceImportError {
  if (isArtifactsError(error)) {
    return {
      tag: "GitHubSourceImportError",
      message: "GitHub repository import failed.",
      code: error.code,
    };
  }

  return {
    tag: "GitHubSourceImportError",
    message: error instanceof Error ? error.message : "GitHub repository import failed.",
  };
}

function isArtifactsError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && error.name === "ArtifactsError" && typeof (error as { code?: unknown }).code === "string";
}
