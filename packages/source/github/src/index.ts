import { Result, type Result as BetterResult } from "better-result";
import { blobEncodingError, fileTooLargeError } from "./errors";
import { GitHubRestSourceClient } from "./client";
import { resolveOptions } from "./options";
import type {
  GitHubBlobEncodingError,
  GitHubSource,
  GitHubSourceEntryError,
  GitHubSourceOptions,
  GitHubSourceResolveError,
  GitHubTreeFile,
  WorkspaceTreeEntry,
} from "./types";

export type {
  FetchFn,
  GitHubAuthenticationError,
  GitHubBlobEncodingError,
  GitHubFileTooLargeError,
  GitHubSource,
  GitHubSourceEntryError,
  GitHubSourceError,
  GitHubSourceNotFoundError,
  GitHubSourceOptions,
  GitHubSourceResolveError,
  GitHubSourceSnapshot,
  GitHubTreeTruncatedError,
  GitHubUpstreamError,
  InvalidGitHubSourceError,
  WorkspaceTreeEntry,
} from "./types";

export async function resolveGitHubSource(options: GitHubSourceOptions): Promise<BetterResult<GitHubSource, GitHubSourceResolveError>> {
  const context = resolveOptions(options);
  if (Result.isError(context)) {
    return Result.err(context.error);
  }

  const client = new GitHubRestSourceClient(context.value);
  const ref = await resolveRef(client, context.value.ref);
  if (Result.isError(ref)) {
    return Result.err(ref.error);
  }

  const commit = await client.commit(ref.value);
  if (Result.isError(commit)) {
    return Result.err(commit.error);
  }

  const files = await client.treeFiles(commit.value.treeSha);
  if (Result.isError(files)) {
    return Result.err(files.error);
  }

  return Result.ok({
    snapshot: {
      type: "github",
      owner: context.value.owner,
      repo: context.value.repo,
      ref: ref.value,
      commitSha: commit.value.commitSha,
    },
    entries() {
      return streamEntries(client, files.value, context.value.maxFileBytes);
    },
  });
}

const BLOB_READ_CONCURRENCY = 8;

async function resolveRef(
  client: GitHubRestSourceClient,
  explicitRef: string | undefined,
): Promise<BetterResult<string, GitHubSourceResolveError>> {
  if (explicitRef) {
    return Result.ok(explicitRef);
  }

  return client.defaultBranch();
}

async function* streamEntries(
  client: GitHubRestSourceClient,
  files: GitHubTreeFile[],
  maxFileBytes: number,
): AsyncIterable<WorkspaceTreeEntry> {
  for (let offset = 0; offset < files.length; offset += BLOB_READ_CONCURRENCY) {
    const chunk = files.slice(offset, offset + BLOB_READ_CONCURRENCY);
    const entries = await Promise.all(chunk.map((file) => readEntry(client, file, maxFileBytes)));
    for (const entry of entries) {
      if (Result.isError(entry)) {
        throw entryStreamError(entry.error);
      }

      yield entry.value;
    }
  }
}

async function readEntry(
  client: GitHubRestSourceClient,
  file: GitHubTreeFile,
  maxFileBytes: number,
): Promise<BetterResult<WorkspaceTreeEntry, GitHubSourceEntryError>> {
  if (typeof file.size === "number" && file.size > maxFileBytes) {
    return Result.err(fileTooLargeError(file.path, file.size, maxFileBytes));
  }

  const blob = await client.blob(file);
  if (Result.isError(blob)) {
    return Result.err(blob.error);
  }

  if (blob.value.size > maxFileBytes) {
    return Result.err(fileTooLargeError(file.path, blob.value.size, maxFileBytes));
  }

  if (blob.value.encoding !== "base64") {
    return Result.err(blobEncodingError(file.path, blob.value.encoding));
  }

  const contents = decodeBase64(blob.value.content, file.path);
  if (Result.isError(contents)) {
    return Result.err(contents.error);
  }

  if (contents.value.byteLength > maxFileBytes) {
    return Result.err(fileTooLargeError(file.path, contents.value.byteLength, maxFileBytes));
  }

  return Result.ok({
    path: file.path,
    contents: contents.value,
  });
}

function entryStreamError(error: GitHubSourceEntryError): Error {
  return Object.assign(new Error(error.message, { cause: error }), error);
}

function decodeBase64(content: string, path: string): BetterResult<Uint8Array, GitHubBlobEncodingError> {
  try {
    const binary = atob(content.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return Result.ok(bytes);
  } catch {
    return Result.err(blobEncodingError(path, "base64"));
  }
}
