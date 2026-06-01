import { Result, type Result as BetterResult } from "better-result";
import type { WorkspaceTreeEntry } from "../model/write-tree";

const WRITE_TREE_BATCH_SIZE = 100;
const WRITE_TREE_BATCH_MAX_BYTES = 16 * 1024 * 1024;

export type WorkspaceTreeEntries = Iterable<WorkspaceTreeEntry> | AsyncIterable<WorkspaceTreeEntry>;

export type WorkspaceTreeSourceError = {
  tag: "WorkspaceTreeSourceError";
  message: string;
  causeMessage?: string;
};

export type WorkspaceTreeEntryTooLargeError = {
  tag: "WorkspaceTreeEntryTooLargeError";
  path: string;
  size: number;
  maxSize: number;
  message: string;
};

export type WorkspaceFileWriteTreeError = WorkspaceTreeEntryTooLargeError | WorkspaceTreeSourceError;

type WriteTreeEntriesError<E> = E | WorkspaceFileWriteTreeError;

export async function writeTreeEntries<E>(
  entries: WorkspaceTreeEntries,
  writeBatch: (batch: WorkspaceTreeEntry[]) => Promise<BetterResult<void, E>>,
): Promise<BetterResult<void, WriteTreeEntriesError<E>>> {
  let batch: WorkspaceTreeEntry[] = [];
  let batchBytes = 0;
  let stoppedWith: WriteTreeEntriesError<E> | undefined;

  try {
    for await (const entry of entries) {
      const entrySize = entry.contents.byteLength;
      if (entrySize > WRITE_TREE_BATCH_MAX_BYTES) {
        stoppedWith = workspaceTreeEntryTooLargeError(entry);
        break;
      }

      if (batch.length > 0 && batchBytes + entrySize > WRITE_TREE_BATCH_MAX_BYTES) {
        const written = await writeBatch(batch);
        if (Result.isError(written)) {
          stoppedWith = written.error;
          break;
        }
        batch = [];
        batchBytes = 0;
      }

      batch.push(entry);
      batchBytes += entrySize;
      if (batch.length === WRITE_TREE_BATCH_SIZE) {
        const written = await writeBatch(batch);
        if (Result.isError(written)) {
          stoppedWith = written.error;
          break;
        }
        batch = [];
        batchBytes = 0;
      }
    }
  } catch (error) {
    return Result.err(stoppedWith ?? workspaceTreeSourceError(error));
  }

  if (stoppedWith) {
    return Result.err(stoppedWith);
  }

  if (batch.length === 0) {
    return Result.ok();
  }

  const written = await writeBatch(batch);
  if (Result.isError(written)) return Result.err(written.error);
  return Result.ok();
}

function workspaceTreeEntryTooLargeError(entry: WorkspaceTreeEntry): WorkspaceTreeEntryTooLargeError {
  return {
    tag: "WorkspaceTreeEntryTooLargeError",
    path: entry.path,
    size: entry.contents.byteLength,
    maxSize: WRITE_TREE_BATCH_MAX_BYTES,
    message: `Workspace tree entry exceeds ${WRITE_TREE_BATCH_MAX_BYTES} bytes: ${entry.path}`,
  };
}

function workspaceTreeSourceError(error: unknown): WorkspaceTreeSourceError {
  const causeMessage = error instanceof Error ? error.message : String(error);
  return {
    tag: "WorkspaceTreeSourceError",
    message: `Workspace tree source failed: ${causeMessage}`,
    causeMessage,
  };
}
