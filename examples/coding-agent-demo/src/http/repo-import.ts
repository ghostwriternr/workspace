import { Result, type Result as BetterResult } from "better-result";
import type { WorkspaceBinding } from "@cloudflare/workspace";
import type { GitHubSource } from "@cloudflare/workspace-source-github";
import { RepoImportController, type RepoImportSummary } from "../repo/import-controller";

const importPathPattern = /^\/api\/workspaces\/([^/]+)\/imports\/github$/;

type GitHubImportBody = {
  owner?: unknown;
  repo?: unknown;
  ref?: unknown;
};

type CodingAgentNamespace = {
  getByName(name: string): { refreshRepoState(lastImport?: RepoImportSummary): Promise<unknown> };
};

type RepoImportRuntime = {
  github: GitHubSource;
  workspaces: WorkspaceBinding;
};

export type RepoImportRequestOptions = {
  agents?: CodingAgentNamespace;
};

export async function handleRepoImportRequest(
  request: Request,
  runtime: RepoImportRuntime,
  options: RepoImportRequestOptions = {},
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = importPathPattern.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  if (request.method !== "POST") {
    return json({ status: "error", message: "Use POST to import a GitHub repository." }, { status: 405 });
  }

  const body = await readImportBody(request);
  if (Result.isError(body)) {
    return json({ status: "error", message: body.error }, { status: 400 });
  }

  const controller = new RepoImportController({
    github: runtime.github,
    workspaces: runtime.workspaces,
  });
  const result = await controller.importGitHubRepo({
    workspaceName: decodeURIComponent(match[1] ?? ""),
    owner: body.value.owner,
    repo: body.value.repo,
    ref: body.value.ref,
  });

  if (Result.isError(result)) {
    return json({ status: "error", error: result.error }, { status: statusForError(result.error) });
  }

  if (options.agents) {
    await options.agents.getByName(result.value.workspaceName).refreshRepoState(result.value);
  }

  return json({ status: "imported", ...result.value });
}

async function readImportBody(request: Request): Promise<BetterResult<{ owner: string; repo: string; ref?: string }, string>> {
  let body: GitHubImportBody;
  try {
    body = await request.json() as GitHubImportBody;
  } catch {
    return Result.err("Request body must be JSON.");
  }

  if (!isImportBody(body)) {
    return Result.err("Request body must be a JSON object.");
  }

  if (typeof body.owner !== "string" || body.owner.length === 0) {
    return Result.err("GitHub owner is required.");
  }
  if (typeof body.repo !== "string" || body.repo.length === 0) {
    return Result.err("GitHub repo is required.");
  }
  if (body.ref !== undefined && typeof body.ref !== "string") {
    return Result.err("GitHub ref must be a string.");
  }

  return Result.ok({ owner: body.owner, repo: body.repo, ref: body.ref });
}

function isImportBody(value: unknown): value is GitHubImportBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusForError(error: { tag: string }): number {
  if (error.tag === "GitHubArtifactsImportError") {
    return 502;
  }
  if (error.tag === "InvalidGitHubRepositoryError") {
    return 400;
  }
  return 409;
}

function json(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, {
    ...init,
    headers: { "cache-control": "no-store", ...init?.headers },
  });
}
