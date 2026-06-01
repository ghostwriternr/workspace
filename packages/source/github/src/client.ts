import { Result, type Result as BetterResult } from "better-result";
import { octokitError, treeTruncatedError, upstreamError } from "./errors";
import type { GitHubSourceContext } from "./options";
import type {
  GitHubCommit,
  GitHubSourceEntryError,
  GitHubSourceResolveError,
  GitHubTransportError,
  GitHubTreeFile,
} from "./types";

type GitHubBlob = {
  encoding: string;
  size: number;
  content: string;
};

export class GitHubRestSourceClient {
  constructor(private readonly context: GitHubSourceContext) {}

  async defaultBranch(): Promise<BetterResult<string, GitHubSourceResolveError>> {
    const repository = await this.request(this.repositoryUrl(), () => this.context.octokit.rest.repos.get({
      owner: this.context.owner,
      repo: this.context.repo,
      request: this.requestOptions(),
    }));
    if (Result.isError(repository)) {
      return Result.err(repository.error);
    }

    if (typeof repository.value.data.default_branch !== "string") {
      return Result.err(upstreamError(this.repositoryUrl(), "GitHub repository response did not include default_branch"));
    }

    return Result.ok(repository.value.data.default_branch);
  }

  async commit(ref: string): Promise<BetterResult<GitHubCommit, GitHubSourceResolveError>> {
    const commit = await this.request(this.commitUrl(ref), () => this.context.octokit.rest.repos.getCommit({
      owner: this.context.owner,
      repo: this.context.repo,
      ref,
      request: this.requestOptions(),
    }));
    if (Result.isError(commit)) {
      return Result.err(commit.error);
    }

    if (typeof commit.value.data.sha !== "string" || typeof commit.value.data.commit?.tree?.sha !== "string") {
      return Result.err(upstreamError(this.commitUrl(ref), "GitHub commit response did not include a commit tree"));
    }

    return Result.ok({
      commitSha: commit.value.data.sha,
      treeSha: commit.value.data.commit.tree.sha,
    });
  }

  async treeFiles(treeSha: string): Promise<BetterResult<GitHubTreeFile[], GitHubSourceResolveError>> {
    const tree = await this.request(this.treeUrl(treeSha), () => this.context.octokit.rest.git.getTree({
      owner: this.context.owner,
      repo: this.context.repo,
      tree_sha: treeSha,
      recursive: "1",
      request: this.requestOptions(),
    }));
    if (Result.isError(tree)) {
      return Result.err(tree.error);
    }

    if (!Array.isArray(tree.value.data.tree)) {
      return Result.err(upstreamError(this.treeUrl(treeSha), "GitHub tree response was not a tree array"));
    }

    if (tree.value.data.truncated) {
      return Result.err(treeTruncatedError(treeSha));
    }

    return normalizeTreeFiles(tree.value.data.tree, this.treeUrl(treeSha));
  }

  async blob(file: GitHubTreeFile): Promise<BetterResult<GitHubBlob, GitHubSourceEntryError>> {
    const blob = await this.request(this.blobUrl(file.sha), () => this.context.octokit.rest.git.getBlob({
      owner: this.context.owner,
      repo: this.context.repo,
      file_sha: file.sha,
      request: this.requestOptions(),
    }));
    if (Result.isError(blob)) {
      return Result.err(blob.error);
    }

    if (
      typeof blob.value.data.size !== "number"
      || typeof blob.value.data.encoding !== "string"
      || typeof blob.value.data.content !== "string"
    ) {
      return Result.err(upstreamError(this.blobUrl(file.sha), "GitHub blob response did not include blob content"));
    }

    return Result.ok({
      encoding: blob.value.data.encoding,
      size: blob.value.data.size,
      content: blob.value.data.content,
    });
  }

  private async request<T>(url: string, request: () => Promise<T>): Promise<BetterResult<T, GitHubTransportError>> {
    try {
      return Result.ok(await request());
    } catch (error) {
      return Result.err(octokitError(url, error));
    }
  }

  private requestOptions(): { signal: AbortSignal } {
    const timeout = AbortSignal.timeout(this.context.timeoutMs);
    return {
      signal: this.context.signal ? AbortSignal.any([this.context.signal, timeout]) : timeout,
    };
  }

  private repositoryUrl(): string {
    return `${this.context.apiBaseUrl}/repos/${encodeURIComponent(this.context.owner)}/${encodeURIComponent(this.context.repo)}`;
  }

  private commitUrl(ref: string): string {
    return `${this.repositoryUrl()}/commits/${encodeURIComponent(ref)}`;
  }

  private treeUrl(treeSha: string): string {
    return `${this.repositoryUrl()}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`;
  }

  private blobUrl(fileSha: string): string {
    return `${this.repositoryUrl()}/git/blobs/${encodeURIComponent(fileSha)}`;
  }
}

function normalizeTreeFiles(
  items: ReadonlyArray<{ path?: string; type?: string; sha?: string; size?: number }>,
  url: string,
): BetterResult<GitHubTreeFile[], GitHubSourceResolveError> {
  const files: GitHubTreeFile[] = [];

  for (const item of items) {
    if (item.type !== "blob") {
      continue;
    }

    if (typeof item.path !== "string" || typeof item.sha !== "string") {
      return Result.err(upstreamError(url, "GitHub tree response included a blob without path or sha"));
    }

    files.push({ path: item.path, sha: item.sha, size: item.size });
  }

  return Result.ok(files);
}
