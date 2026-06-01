import { Octokit } from "@octokit/rest";
import { Result, type Result as BetterResult } from "better-result";
import { invalidSourceError } from "./errors";
import type { FetchFn, GitHubSourceOptions, InvalidGitHubSourceError } from "./types";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;

export type GitHubSourceContext = {
  owner: string;
  repo: string;
  ref?: string;
  octokit: InstanceType<typeof Octokit>;
  apiBaseUrl: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxFileBytes: number;
};

export function resolveOptions(options: GitHubSourceOptions): BetterResult<GitHubSourceContext, InvalidGitHubSourceError> {
  const owner = validateName("owner", options.owner);
  if (Result.isError(owner)) return Result.err(owner.error);

  const repo = validateName("repo", options.repo);
  if (Result.isError(repo)) return Result.err(repo.error);

  const ref = options.ref === undefined ? undefined : validateRef(options.ref);
  if (ref && Result.isError(ref)) return Result.err(ref.error);

  const apiBaseUrl = validateApiBaseUrl(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
  if (Result.isError(apiBaseUrl)) return Result.err(apiBaseUrl.error);

  const maxFileBytes = validatePositiveInteger("maxFileBytes", options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  if (Result.isError(maxFileBytes)) return Result.err(maxFileBytes.error);

  const timeoutMs = validatePositiveInteger("timeoutMs", options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (Result.isError(timeoutMs)) return Result.err(timeoutMs.error);

  const fetch = options.fetch ?? defaultFetch;

  return Result.ok({
    owner: owner.value,
    repo: repo.value,
    ref: ref?.value,
    octokit: new Octokit({
      auth: options.token,
      baseUrl: apiBaseUrl.value,
      userAgent: "cloudflare-workspace-source-github",
      log: silentOctokitLog,
      request: { fetch },
    }),
    apiBaseUrl: apiBaseUrl.value,
    maxFileBytes: maxFileBytes.value,
    timeoutMs: timeoutMs.value,
    signal: options.signal,
  });
}

const defaultFetch: FetchFn = (input, init) => globalThis.fetch(input, init);

const silentOctokitLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function validateName(field: "owner" | "repo", value: string): BetterResult<string, InvalidGitHubSourceError> {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    return Result.err(invalidSourceError(field, `Invalid GitHub ${field}: ${value}`));
  }

  return Result.ok(value);
}

function validateRef(value: string): BetterResult<string, InvalidGitHubSourceError> {
  if (value.length === 0 || value.includes("\0") || value.includes("..") || value.startsWith("/") || value.endsWith("/")) {
    return Result.err(invalidSourceError("ref", `Invalid GitHub ref: ${value}`));
  }

  return Result.ok(value);
}

function validateApiBaseUrl(value: string): BetterResult<string, InvalidGitHubSourceError> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return Result.err(invalidApiBaseUrl(value));
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash) {
    return Result.err(invalidApiBaseUrl(value));
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return Result.ok(url.toString().replace(/\/$/, ""));
}

function invalidApiBaseUrl(value: string): InvalidGitHubSourceError {
  return invalidSourceError("apiBaseUrl", `Invalid GitHub API base URL: ${value}`);
}

function validatePositiveInteger(
  field: "maxFileBytes" | "timeoutMs",
  value: number,
): BetterResult<number, InvalidGitHubSourceError> {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return Result.err(invalidSourceError(field, `GitHub source ${field} must be a positive integer`));
  }

  return Result.ok(value);
}
