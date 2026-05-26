import { Result } from "better-result";
import { RpcTarget } from "cloudflare:workers";
import { WorkspaceBlobStore } from "../storage/blob-store";
import type { SessionNotFoundError } from "../model/errors";
import {
  deleteFromTree,
  listTree,
  mkdirInTree,
  readFileFromTree,
  statTree,
  validateWriteTarget,
  writeBlobRefToTree,
} from "../model/operations";
import {
  commitWorkspaceSession,
  discardWorkspaceSession,
  requireOpenSession,
} from "../model/sessions";
import {
  toRpcError,
  toRpcResult,
  type WorkspaceSessionCommitRpcResult,
  type WorkspaceSessionDeleteRpcResult,
  type WorkspaceSessionDiscardRpcResult,
  type WorkspaceSessionInfoRpcResult,
  type WorkspaceSessionListRpcResult,
  type WorkspaceSessionMkdirRpcResult,
  type WorkspaceSessionReadRpcResult,
  type WorkspaceSessionStatRpcResult,
  type WorkspaceSessionWriteRpcResult,
} from "../model/rpc";
import { sessionTree } from "../storage/sql-entry-tree";
import type { MutableTree } from "../storage/tree";

export class WorkspaceSession extends RpcTarget {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly bucket: R2Bucket,
    private readonly sessionId: string,
  ) {
    super();
  }

  // Disposing the RPC capability must not discard durable session state. Call commit() or
  // discard() for the explicit durability boundary.
  [Symbol.dispose](): void {}

  async info(): Promise<WorkspaceSessionInfoRpcResult> {
    return toRpcResult(requireOpenSession(this.storage.sql, this.sessionId));
  }

  async mkdir(path: string): Promise<WorkspaceSessionMkdirRpcResult> {
    const tree = this.openTree();
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(mkdirInTree(tree.value, path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<WorkspaceSessionWriteRpcResult> {
    const tree = this.openTree();
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    const preflight = validateWriteTarget(tree.value, path);
    if (Result.isError(preflight)) {
      return toRpcResult(preflight);
    }

    const blob = await this.blobs().put(contents);

    const currentTree = this.openTree();
    if (Result.isError(currentTree)) {
      return toRpcError(currentTree.error);
    }

    return toRpcResult(writeBlobRefToTree(currentTree.value, path, blob));
  }

  async readFile(path: string): Promise<WorkspaceSessionReadRpcResult> {
    const tree = this.openTree();
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(await readFileFromTree(tree.value, this.blobs(), path));
  }

  async list(path: string): Promise<WorkspaceSessionListRpcResult> {
    const tree = this.openTree();
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(listTree(tree.value, path));
  }

  async delete(path: string): Promise<WorkspaceSessionDeleteRpcResult> {
    const tree = this.openTree();
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(deleteFromTree(tree.value, path));
  }

  async stat(path: string): Promise<WorkspaceSessionStatRpcResult> {
    const tree = this.openTree();
    if (Result.isError(tree)) {
      return toRpcError(tree.error);
    }

    return toRpcResult(statTree(tree.value, path));
  }

  async commit(): Promise<WorkspaceSessionCommitRpcResult> {
    return toRpcResult(commitWorkspaceSession(this.storage, this.sessionId));
  }

  async discard(): Promise<WorkspaceSessionDiscardRpcResult> {
    return toRpcResult(discardWorkspaceSession(this.storage, this.sessionId));
  }

  private openTree(): Result<MutableTree, SessionNotFoundError> {
    const session = requireOpenSession(this.storage.sql, this.sessionId);
    if (Result.isError(session)) {
      return Result.err(session.error);
    }

    return Result.ok(sessionTree(this.storage.sql, this.sessionId));
  }

  private blobs(): WorkspaceBlobStore {
    return new WorkspaceBlobStore(this.bucket);
  }
}
