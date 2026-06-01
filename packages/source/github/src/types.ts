export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type WorkspaceTreeEntry = {
  path: string;
  contents: Uint8Array;
};

export type GitHubSourceOptions = {
  owner: string;
  repo: string;
  ref?: string;
  token?: string;
  fetch?: FetchFn;
  apiBaseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxFileBytes?: number;
};

export type GitHubSourceSnapshot = {
  type: "github";
  owner: string;
  repo: string;
  ref: string;
  commitSha: string;
};

export type GitHubSource = {
  snapshot: GitHubSourceSnapshot;
  entries(): AsyncIterable<WorkspaceTreeEntry>;
};

export type InvalidGitHubSourceError = {
  tag: "InvalidGitHubSourceError";
  field: "owner" | "repo" | "ref" | "apiBaseUrl" | "maxFileBytes" | "timeoutMs";
  message: string;
};

export type GitHubSourceNotFoundError = {
  tag: "GitHubSourceNotFoundError";
  status: number;
  url: string;
  message: string;
};

export type GitHubAuthenticationError = {
  tag: "GitHubAuthenticationError";
  status: number;
  url: string;
  message: string;
};

export type GitHubUpstreamError = {
  tag: "GitHubUpstreamError";
  url: string;
  status?: number;
  message: string;
  causeMessage?: string;
};

export type GitHubTreeTruncatedError = {
  tag: "GitHubTreeTruncatedError";
  treeSha: string;
  message: string;
};

export type GitHubFileTooLargeError = {
  tag: "GitHubFileTooLargeError";
  path: string;
  size: number;
  maxSize: number;
  message: string;
};

export type GitHubBlobEncodingError = {
  tag: "GitHubBlobEncodingError";
  path: string;
  encoding: string;
  message: string;
};

export type GitHubTransportError = GitHubSourceNotFoundError | GitHubAuthenticationError | GitHubUpstreamError;

export type GitHubSourceResolveError =
  | InvalidGitHubSourceError
  | GitHubSourceNotFoundError
  | GitHubAuthenticationError
  | GitHubUpstreamError
  | GitHubTreeTruncatedError;

export type GitHubSourceEntryError =
  | GitHubSourceNotFoundError
  | GitHubAuthenticationError
  | GitHubUpstreamError
  | GitHubFileTooLargeError
  | GitHubBlobEncodingError;

export type GitHubSourceError = GitHubSourceResolveError | GitHubSourceEntryError;

export type GitHubTreeFile = {
  path: string;
  sha: string;
  size?: number;
};

export type GitHubCommit = {
  commitSha: string;
  treeSha: string;
};
