import { Result } from "better-result";
import { DurableObject } from "cloudflare:workers";
import { WorkspaceBlobStore } from "../storage/blob-store";
import type { RevisionNotFoundError, SessionNotFoundError, WorkspaceError, WorkspaceWriteTreeError } from "../model/errors";
import { bumpHeadVersion } from "../storage/head-state";
import {
  deleteFromTree,
  listTree,
  mkdirInTree,
  readFileFromTree,
  statTree,
  validateWriteTarget,
  writeBlobRefToTree,
} from "../model/operations";
import { createRevisionFromHead, requireRevision } from "../model/revisions";
import {
  toRpcError,
  toRpcResult,
  type WorkspaceSnapshotResult,
  type WorkspaceSnapshotRpcResult,
  type WorkspaceDeleteRpcResult,
  type WorkspaceListRpcResult,
  type WorkspaceMkdirRpcResult,
  type WorkspaceReadOptions,
  type WorkspaceReadRpcResult,
  type WorkspaceSessionCommitRpcResult,
  type WorkspaceSessionDeleteRpcResult,
  type WorkspaceSessionDiscardRpcResult,
  type WorkspaceSessionInfoRpcResult,
  type WorkspaceSessionListRpcResult,
  type WorkspaceSessionMkdirRpcResult,
  type WorkspaceSessionReadRpcResult,
  type WorkspaceSessionStatRpcResult,
  type WorkspaceSessionWriteRpcResult,
  type WorkspaceSessionWriteTreeBatchRpcResult,
  type WorkspaceRpcResult,
  type WorkspaceStatRpcResult,
  type WorkspaceWriteRpcResult,
} from "../model/rpc";
import {
  buildWriteTreePlan,
  validateWriteTreePlan,
  writeTreePlanToTree,
  type WorkspaceTreeEntry,
  type WorkspaceWriteTreePlan,
} from "../model/write-tree";
import { initializeWorkspaceSchema } from "../storage/schema";
import {
  beginWorkspaceSession,
  commitWorkspaceSession,
  discardWorkspaceSession,
  requireOpenSession,
} from "../model/sessions";
import { headTree, revisionTree, sessionTree } from "../storage/sql-entry-tree";
import type { BlobRef, MutableTree, ReadableTree } from "../storage/tree";

export interface Env {
  WORKSPACE_BLOBS: R2Bucket;
}

const WRITE_TREE_BLOB_PUT_CONCURRENCY = 16;

type PreparedWriteTree = {
  plan: WorkspaceWriteTreePlan;
  blobs: BlobRef[];
};

export class WorkspaceObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      initializeWorkspaceSchema(this.ctx.storage.sql);
    });
  }

  async snapshot(): Promise<WorkspaceSnapshotRpcResult> {
    return toRpcResult(this.snapshotInternal());
  }

  async beginSession(): Promise<WorkspaceSessionInfoRpcResult> {
    return toRpcResult(Result.ok(beginWorkspaceSession(this.ctx.storage)));
  }

  async getSession(sessionId: string): Promise<WorkspaceSessionInfoRpcResult> {
    return toRpcResult(requireOpenSession(this.ctx.storage.sql, sessionId));
  }

  async mkdir(path: string): Promise<WorkspaceMkdirRpcResult> {
    return toRpcResult(
      this.ctx.storage.transactionSync(() => {
        const result = mkdirInTree(this.head(), path);
        if (!Result.isError(result)) {
          bumpHeadVersion(this.ctx.storage.sql);
        }
        return result;
      }),
    );
  }

  async writeFile(path: string, contents: Uint8Array): Promise<WorkspaceWriteRpcResult> {
    const tree = this.head();
    const preflight = validateWriteTarget(tree, path);
    if (Result.isError(preflight)) {
      return toRpcResult(preflight);
    }

    const blob = await this.blobs().put(contents);
    return toRpcResult(
      this.ctx.storage.transactionSync(() => {
        const result = writeBlobRefToTree(this.head(), path, blob);
        if (!Result.isError(result)) {
          bumpHeadVersion(this.ctx.storage.sql);
        }
        return result;
      }),
    );
  }

  async readFile(path: string, options: WorkspaceReadOptions = {}): Promise<WorkspaceReadRpcResult> {
    const tree = this.readableTree(options);
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(await readFileFromTree(tree.value, this.blobs(), path));
  }

  async list(path: string, options: WorkspaceReadOptions = {}): Promise<WorkspaceListRpcResult> {
    const tree = this.readableTree(options);
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(listTree(tree.value, path));
  }

  async delete(path: string): Promise<WorkspaceDeleteRpcResult> {
    return toRpcResult(
      this.ctx.storage.transactionSync(() => {
        const result = deleteFromTree(this.head(), path);
        if (!Result.isError(result)) {
          bumpHeadVersion(this.ctx.storage.sql);
        }
        return result;
      }),
    );
  }

  async stat(path: string, options: WorkspaceReadOptions = {}): Promise<WorkspaceStatRpcResult> {
    const tree = this.readableTree(options);
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(statTree(tree.value, path));
  }

  async sessionMkdir(sessionId: string, path: string): Promise<WorkspaceSessionMkdirRpcResult> {
    return this.withSessionTree(sessionId, (tree) => mkdirInTree(tree, path));
  }

  async sessionWriteFile(sessionId: string, path: string, contents: Uint8Array): Promise<WorkspaceSessionWriteRpcResult> {
    const tree = this.openSessionTree(sessionId);
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    const preflight = validateWriteTarget(tree.value, path);
    if (Result.isError(preflight)) {
      return toRpcResult(preflight);
    }

    const blob = await this.blobs().put(contents);
    return this.withSessionTree(sessionId, (currentTree) => writeBlobRefToTree(currentTree, path, blob));
  }

  async sessionWriteTreeBatch(sessionId: string, root: string, entries: WorkspaceTreeEntry[]): Promise<WorkspaceSessionWriteTreeBatchRpcResult> {
    const tree = this.openSessionTree(sessionId);
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    const prepared = await this.prepareWriteTree(tree.value, root, entries);
    if (Result.isError(prepared)) {
      return toRpcResult(prepared);
    }

    return this.withSessionTree(sessionId, (currentTree) => writeTreePlanToTree(currentTree, prepared.value.plan, prepared.value.blobs));
  }

  async sessionReadFile(sessionId: string, path: string): Promise<WorkspaceSessionReadRpcResult> {
    const tree = this.openSessionTree(sessionId);
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(await readFileFromTree(tree.value, this.blobs(), path));
  }

  async sessionList(sessionId: string, path: string): Promise<WorkspaceSessionListRpcResult> {
    return this.withSessionTree(sessionId, (tree) => listTree(tree, path));
  }

  async sessionDelete(sessionId: string, path: string): Promise<WorkspaceSessionDeleteRpcResult> {
    return this.withSessionTree(sessionId, (tree) => deleteFromTree(tree, path));
  }

  async sessionStat(sessionId: string, path: string): Promise<WorkspaceSessionStatRpcResult> {
    return this.withSessionTree(sessionId, (tree) => statTree(tree, path));
  }

  async sessionCommit(sessionId: string): Promise<WorkspaceSessionCommitRpcResult> {
    return toRpcResult(commitWorkspaceSession(this.ctx.storage, sessionId));
  }

  async sessionDiscard(sessionId: string): Promise<WorkspaceSessionDiscardRpcResult> {
    return toRpcResult(discardWorkspaceSession(this.ctx.storage, sessionId));
  }

  private snapshotInternal(): WorkspaceSnapshotResult {
    return this.ctx.storage.transactionSync(() => createRevisionFromHead(this.ctx.storage.sql));
  }

  private async prepareWriteTree(
    tree: MutableTree,
    root: string,
    entries: WorkspaceTreeEntry[],
  ): Promise<Result<PreparedWriteTree, WorkspaceWriteTreeError>> {
    const plan = buildWriteTreePlan(root, entries);
    if (Result.isError(plan)) {
      return Result.err(plan.error);
    }

    const validation = validateWriteTreePlan(tree, plan.value);
    if (Result.isError(validation)) {
      return Result.err(validation.error);
    }

    return Result.ok({
      plan: plan.value,
      blobs: await this.putTreeBlobs(entries),
    });
  }

  private async putTreeBlobs(entries: WorkspaceTreeEntry[]): Promise<BlobRef[]> {
    const blobs = this.blobs();
    const refs: BlobRef[] = [];
    for (let offset = 0; offset < entries.length; offset += WRITE_TREE_BLOB_PUT_CONCURRENCY) {
      const chunk = entries.slice(offset, offset + WRITE_TREE_BLOB_PUT_CONCURRENCY);
      refs.push(...await Promise.all(chunk.map((entry) => blobs.put(entry.contents))));
    }
    return refs;
  }

  private readableTree(options: WorkspaceReadOptions): Result<ReadableTree, RevisionNotFoundError> {
    const revision = requireRevision(this.ctx.storage.sql, options.revisionId);
    if (Result.isError(revision)) {
      return Result.err(revision.error);
    }

    return Result.ok(revision.value ? revisionTree(this.ctx.storage.sql, revision.value) : this.head());
  }

  private withSessionTree<T, E extends WorkspaceError>(
    sessionId: string,
    operation: (tree: MutableTree) => Result<T, E>,
  ): WorkspaceRpcResult<T, E | SessionNotFoundError> {
    const tree = this.openSessionTree(sessionId);
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(operation(tree.value));
  }

  private openSessionTree(sessionId: string): Result<MutableTree, SessionNotFoundError> {
    const session = requireOpenSession(this.ctx.storage.sql, sessionId);
    if (Result.isError(session)) {
      return Result.err(session.error);
    }

    return Result.ok(sessionTree(this.ctx.storage.sql, sessionId));
  }

  private head(): MutableTree {
    return headTree(this.ctx.storage.sql);
  }

  private blobs(): WorkspaceBlobStore {
    return new WorkspaceBlobStore(this.env.WORKSPACE_BLOBS);
  }
}
