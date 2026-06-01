import { Result, type Result as BetterResult } from "better-result";
import type { WorkspaceNamespace } from "@cloudflare/workspace";
import { RepoImportController, type GitHubSourceResolver } from "../repo/import-controller";

const importPathPattern = /^\/api\/workspaces\/([^/]+)\/imports\/github$/;

type GitHubImportBody = {
  owner?: unknown;
  repo?: unknown;
  ref?: unknown;
};

export async function handleRepoImportRequest(
  request: Request,
  workspaces: WorkspaceNamespace,
  resolveSource?: GitHubSourceResolver,
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

  const controller = new RepoImportController({ workspaces, resolveSource });
  const result = await controller.importGitHubRepo({
    workspaceName: decodeURIComponent(match[1] ?? ""),
    owner: body.value.owner,
    repo: body.value.repo,
    ref: body.value.ref,
  });

  if (Result.isError(result)) {
    return json({ status: "error", error: result.error }, { status: statusForError(result.error) });
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
  if (error.tag === "InvalidGitHubSourceError" || error.tag === "InvalidPathError") {
    return 400;
  }
  if (error.tag === "GitHubAuthenticationError") {
    return 401;
  }
  if (error.tag === "GitHubSourceNotFoundError") {
    return 404;
  }
  if (error.tag === "GitHubUpstreamError" || error.tag === "GitHubTreeTruncatedError") {
    return 502;
  }
  return 409;
}

function json(value: unknown, init?: ResponseInit): Response {
  return Response.json(value, {
    ...init,
    headers: { "cache-control": "no-store", ...init?.headers },
  });
}
