import type {
  GitHubAuthenticationError,
  GitHubBlobEncodingError,
  GitHubFileTooLargeError,
  GitHubSourceNotFoundError,
  GitHubTransportError,
  GitHubTreeTruncatedError,
  GitHubUpstreamError,
  InvalidGitHubSourceError,
} from "./types";

export function invalidSourceError(
  field: InvalidGitHubSourceError["field"],
  message: string,
): InvalidGitHubSourceError {
  return {
    tag: "InvalidGitHubSourceError",
    field,
    message,
  };
}

export function treeTruncatedError(treeSha: string): GitHubTreeTruncatedError {
  return {
    tag: "GitHubTreeTruncatedError",
    treeSha,
    message: `GitHub tree is truncated for ${treeSha}`,
  };
}

export function fileTooLargeError(path: string, size: number, maxSize: number): GitHubFileTooLargeError {
  return {
    tag: "GitHubFileTooLargeError",
    path,
    size,
    maxSize,
    message: `GitHub file exceeds ${maxSize} bytes: ${path}`,
  };
}

export function blobEncodingError(path: string, encoding: string): GitHubBlobEncodingError {
  return {
    tag: "GitHubBlobEncodingError",
    path,
    encoding,
    message: encoding === "base64"
      ? `GitHub blob content was not valid base64 for ${path}`
      : `Unsupported GitHub blob encoding for ${path}: ${encoding}`,
  };
}

export function upstreamError(url: string, message: string, cause?: unknown): GitHubUpstreamError {
  return {
    tag: "GitHubUpstreamError",
    url,
    message,
    causeMessage: cause === undefined ? undefined : errorMessage(cause),
  };
}

export function octokitError(url: string, error: unknown): GitHubTransportError {
  const status = errorStatus(error);
  if (status === 404) {
    return notFoundError(url, status);
  }

  if (status === 401 || status === 403) {
    return authenticationError(url, status);
  }

  return {
    tag: "GitHubUpstreamError",
    status,
    url,
    message: status === undefined
      ? `GitHub request failed: ${errorMessage(error)}`
      : `GitHub request failed with status ${status}`,
    causeMessage: errorMessage(error),
  };
}

function notFoundError(url: string, status: number): GitHubSourceNotFoundError {
  return {
    tag: "GitHubSourceNotFoundError",
    status,
    url,
    message: `GitHub resource not found: ${url}`,
  };
}

function authenticationError(url: string, status: number): GitHubAuthenticationError {
  return {
    tag: "GitHubAuthenticationError",
    status,
    url,
    message: `GitHub authentication failed with status ${status}`,
  };
}

function errorStatus(error: unknown): number | undefined {
  if (isRecord(error) && typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
