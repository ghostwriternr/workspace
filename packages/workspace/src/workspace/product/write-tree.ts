import { Result, type Result as BetterResult } from "better-result";
import type { WorkspaceSessionWriteTreeBatchRpcResult } from "../model/rpc";
import type { WorkspaceTreeEntry } from "../model/write-tree";

const WRITE_TREE_BATCH_SIZE = 100;
const WRITE_TREE_BATCH_MAX_BYTES = 16 * 1024 * 1024;

type RpcErrorOf<T> = T extends { status: "error"; error: infer E } ? E : never;

type RpcResult<T, E> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: E };

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

export type WorkspaceFileWriteTreeError =
  | RpcErrorOf<WorkspaceSessionWriteTreeBatchRpcResult>
  | WorkspaceTreeEntryTooLargeError
  | WorkspaceTreeSourceError;

export async function writeTreeEntries(
  entries: WorkspaceTreeEntries,
  writeBatch: (batch: WorkspaceTreeEntry[]) => Promise<WorkspaceSessionWriteTreeBatchRpcResult>,
): Promise<BetterResult<void, WorkspaceFileWriteTreeError>> {
  const iterator = asyncIteratorFor(entries);
  let batch: WorkspaceTreeEntry[] = [];
  let batchBytes = 0;

  while (true) {
    const next = await nextTreeEntry(iterator);
    if (Result.isError(next)) {
      await closeIterator(iterator);
      return Result.err(next.error);
    }
    if (next.value.done) {
      break;
    }

    const entry = next.value.value;
    const entrySize = entry.contents.byteLength;
    if (entrySize > WRITE_TREE_BATCH_MAX_BYTES) {
      await closeIterator(iterator);
      return Result.err(workspaceTreeEntryTooLargeError(entry));
    }

    if (batch.length > 0 && batchBytes + entrySize > WRITE_TREE_BATCH_MAX_BYTES) {
      const written = await writeTreeBatch(batch, writeBatch);
      if (Result.isError(written)) {
        await closeIterator(iterator);
        return written;
      }
      batch = [];
      batchBytes = 0;
    }

    batch.push(entry);
    batchBytes += entrySize;
    if (batch.length === WRITE_TREE_BATCH_SIZE) {
      const written = await writeTreeBatch(batch, writeBatch);
      if (Result.isError(written)) {
        await closeIterator(iterator);
        return written;
      }
      batch = [];
      batchBytes = 0;
    }
  }

  if (batch.length > 0) {
    const written = await writeTreeBatch(batch, writeBatch);
    if (Result.isError(written)) {
      await closeIterator(iterator);
    }
    return written;
  }

  return Result.ok();
}

async function writeTreeBatch(
  batch: WorkspaceTreeEntry[],
  writeBatch: (batch: WorkspaceTreeEntry[]) => Promise<WorkspaceSessionWriteTreeBatchRpcResult>,
): Promise<BetterResult<void, WorkspaceFileWriteTreeError>> {
  return rpcToResult(await writeBatch(batch));
}

function asyncIteratorFor(entries: WorkspaceTreeEntries): AsyncIterator<WorkspaceTreeEntry> {
  if (Symbol.asyncIterator in entries) {
    return entries[Symbol.asyncIterator]();
  }

  const iterator = entries[Symbol.iterator]();
  return {
    async next() {
      return iterator.next();
    },
    async return(value?: unknown) {
      if (iterator.return) {
        return iterator.return(value as never);
      }
      return { done: true, value: value as WorkspaceTreeEntry };
    },
    async throw(error?: unknown) {
      if (iterator.throw) {
        return iterator.throw(error);
      }
      throw error;
    },
  };
}

async function nextTreeEntry(
  iterator: AsyncIterator<WorkspaceTreeEntry>,
): Promise<BetterResult<IteratorResult<WorkspaceTreeEntry>, WorkspaceTreeSourceError>> {
  try {
    return Result.ok(await iterator.next());
  } catch (error) {
    return Result.err(workspaceTreeSourceError(error));
  }
}

async function closeIterator(iterator: AsyncIterator<WorkspaceTreeEntry>): Promise<void> {
  try {
    await iterator.return?.();
  } catch {
    // Preserve the error that caused iteration to stop.
  }
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

function rpcToResult<T, E>(result: RpcResult<T, E>): BetterResult<T, E> {
  if (result.status === "error") {
    return Result.err(result.error);
  }

  return Result.ok(result.value as T);
}
