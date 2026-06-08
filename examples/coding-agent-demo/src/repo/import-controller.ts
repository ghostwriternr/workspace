import { Result, type Result as BetterResult } from "better-result";
import type { WorkspaceObjectClient } from "@cloudflare/workspace";

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
  source: GitHubArtifactSourceSnapshot;
  revisionId: string;
  createdAt: number;
};

type GitHubArtifactSourceSnapshot = {
  type: "github";
  owner: string;
  repo: string;
  ref: string;
  repositoryId: string;
};

type ArtifactsImportError = {
  tag: "ArtifactsImportError";
  message: string;
  code?: string;
};

export type RepoImportError = ArtifactsImportError;

export type ArtifactsImportBinding = {
  import(params: {
    source: { url: string; branch?: string; depth?: number };
    target: { name: string; opts?: { description?: string; readOnly?: boolean } };
  }): Promise<{ id: string; remote?: string; defaultBranch?: string; token?: string }>;
};

export type RepoImportControllerDependencies = {
  artifacts: ArtifactsImportBinding;
  workspaceObjectForName(name: string): WorkspaceObjectClient;
};

export class RepoImportController {
  constructor(private readonly dependencies: RepoImportControllerDependencies) {}

  async importGitHubRepo(request: RepoImportRequest): Promise<BetterResult<RepoImportSummary, RepoImportError>> {
    const ref = request.ref ?? "HEAD";
    try {
      const imported = await this.dependencies.artifacts.import({
        source: {
          url: `https://github.com/${request.owner}/${request.repo}.git`,
          branch: request.ref,
          depth: 1,
        },
        target: {
          name: request.workspaceName,
          opts: {
            description: `Imported from github.com/${request.owner}/${request.repo}`,
          },
        },
      });

      const access = workspaceAccessFrom(imported, request.ref);
      if (!access) {
        return Result.err({
          tag: "ArtifactsImportError",
          message: "Artifacts import response did not include repository access metadata.",
        });
      }

      await this.dependencies.workspaceObjectForName(request.workspaceName).recordCurrentRepository({
        repository: request.workspaceName,
        ...access,
      });

      return Result.ok({
        workspaceName: request.workspaceName,
        root: request.root ?? "/",
        source: {
          type: "github",
          owner: request.owner,
          repo: request.repo,
          ref,
          repositoryId: imported.id,
        },
        revisionId: imported.id,
        createdAt: Date.now(),
      });
    } catch (error) {
      return Result.err(artifactsImportError(error));
    }
  }
}

function workspaceAccessFrom(imported: { remote?: string; defaultBranch?: string }, ref?: string): { remote: string; defaultBranch: string } | undefined {
  if (!imported.remote) {
    return undefined;
  }
  const defaultBranch = ref ?? imported.defaultBranch;
  if (!defaultBranch) {
    return undefined;
  }
  return { remote: imported.remote, defaultBranch };
}

function artifactsImportError(error: unknown): ArtifactsImportError {
  if (isArtifactsError(error)) {
    return {
      tag: "ArtifactsImportError",
      message: error.message,
      code: error.code,
    };
  }

  return {
    tag: "ArtifactsImportError",
    message: error instanceof Error ? error.message : "Artifacts import failed.",
  };
}

function isArtifactsError(error: unknown): error is Error & { name: "ArtifactsError"; code: string } {
  return error instanceof Error && error.name === "ArtifactsError" && typeof (error as { code?: unknown }).code === "string";
}
