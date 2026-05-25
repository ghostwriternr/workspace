import { Result } from "better-result";
import { DurableObject } from "cloudflare:workers";
import { WorkspaceBlobStore } from "./blob-store";
import type { RevisionNotFoundError } from "./errors";
import { bumpHeadVersion } from "./head-state";
import {
  deleteFromTree,
  listTree,
  mkdirInTree,
  readFileFromTree,
  statTree,
  validateWriteTarget,
  writeBlobRefToTree,
} from "./operations";
import { createRevisionFromHead, requireRevision } from "./revisions";
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
  type WorkspaceSessionLookupRpcResult,
  type WorkspaceStatRpcResult,
  type WorkspaceWriteRpcResult,
} from "./rpc";
import { initializeWorkspaceSchema } from "./schema";
import { beginWorkspaceSession, requireOpenSession } from "./sessions";
import { headTree, revisionTree } from "./sql-entry-tree";
import type { MutableTree, ReadableTree } from "./tree";
import { WorkspaceSession } from "./workspace-session";

export interface Env {
  WORKSPACE_BLOBS: R2Bucket;
}

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

  async beginSession(): Promise<WorkspaceSession> {
    const session = beginWorkspaceSession(this.ctx.storage);
    return new WorkspaceSession(this.ctx.storage, this.env.WORKSPACE_BLOBS, session.sessionId);
  }

  async getSession(sessionId: string): Promise<WorkspaceSessionLookupRpcResult> {
    const session = requireOpenSession(this.ctx.storage.sql, sessionId);
    if (Result.isError(session)) {
      return toRpcError(session.error);
    }

    return toRpcResult(
      Result.ok(new WorkspaceSession(this.ctx.storage, this.env.WORKSPACE_BLOBS, session.value.sessionId)),
    );
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

  private snapshotInternal(): WorkspaceSnapshotResult {
    return this.ctx.storage.transactionSync(() => createRevisionFromHead(this.ctx.storage.sql));
  }

  private readableTree(options: WorkspaceReadOptions): Result<ReadableTree, RevisionNotFoundError> {
    const revision = requireRevision(this.ctx.storage.sql, options.revisionId);
    if (Result.isError(revision)) {
      return Result.err(revision.error);
    }

    return Result.ok(revision.value ? revisionTree(this.ctx.storage.sql, revision.value) : this.head());
  }

  private head(): MutableTree {
    return headTree(this.ctx.storage.sql);
  }

  private blobs(): WorkspaceBlobStore {
    return new WorkspaceBlobStore(this.env.WORKSPACE_BLOBS);
  }
}
