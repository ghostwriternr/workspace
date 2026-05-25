import { Result } from "better-result";
import { DurableObject } from "cloudflare:workers";
import {
  DirectoryNotEmptyError,
  IsDirectoryError,
  NotDirectoryError,
  PathAlreadyExistsError,
  PathNotFoundError,
  type WorkspaceWriteError,
} from "./errors";
import { nameFromPath, parentPath, parseWorkspacePath } from "./path";
import {
  toRpcResult,
  type WorkspaceDeleteResult,
  type WorkspaceDeleteRpcResult,
  type WorkspaceEntry,
  type WorkspaceListResult,
  type WorkspaceListRpcResult,
  type WorkspaceMkdirResult,
  type WorkspaceMkdirRpcResult,
  type WorkspaceReadResult,
  type WorkspaceReadRpcResult,
  type WorkspaceStat,
  type WorkspaceStatResult,
  type WorkspaceStatRpcResult,
  type WorkspaceWriteResult,
  type WorkspaceWriteRpcResult,
} from "./rpc";

export interface Env {
  WORKSPACE_BLOBS: R2Bucket;
}

type EntryRow = {
  path: string;
  type: "directory" | "file";
  blob_key: string | null;
  size: number | null;
  created_at: number;
  updated_at: number;
};

export class WorkspaceObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initializeSchema();
    });
  }

  async mkdir(path: string): Promise<WorkspaceMkdirRpcResult> {
    return toRpcResult(this.mkdirInternal(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<WorkspaceWriteRpcResult> {
    return toRpcResult(await this.writeFileInternal(path, contents));
  }

  async readFile(path: string): Promise<WorkspaceReadRpcResult> {
    return toRpcResult(await this.readFileInternal(path));
  }

  async list(path: string): Promise<WorkspaceListRpcResult> {
    return toRpcResult(this.listInternal(path));
  }

  async delete(path: string): Promise<WorkspaceDeleteRpcResult> {
    return toRpcResult(this.deleteInternal(path));
  }

  async stat(path: string): Promise<WorkspaceStatRpcResult> {
    return toRpcResult(this.statInternal(path));
  }

  private mkdirInternal(path: string): WorkspaceMkdirResult {
    const parsed = parseWorkspacePath(path, { allowRoot: false });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const parent = this.requireParentDirectory(path);
    if (Result.isError(parent)) {
      return Result.err(parent.error);
    }

    if (this.getEntry(path)) {
      return Result.err(new PathAlreadyExistsError({ path }));
    }

    const now = Date.now();
    this.insertDirectory(path, now);
    return Result.ok();
  }

  private async writeFileInternal(
    path: string,
    contents: Uint8Array,
  ): Promise<WorkspaceWriteResult> {
    const parsed = parseWorkspacePath(path, { allowRoot: false });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const preflight = this.validateWriteTarget(path);
    if (Result.isError(preflight)) {
      return Result.err(preflight.error);
    }

    const bytes = new Uint8Array(contents);
    const blobKey = await blobKeyFor(bytes);
    await this.env.WORKSPACE_BLOBS.put(blobKey, bytes);

    const metadataValidation = this.validateWriteTarget(path);
    if (Result.isError(metadataValidation)) {
      return Result.err(metadataValidation.error);
    }

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO entries
       (path, parent_path, name, type, blob_key, size, created_at, updated_at)
       VALUES (?, ?, ?, 'file', ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         type = 'file',
         blob_key = excluded.blob_key,
         size = excluded.size,
         updated_at = excluded.updated_at`,
      path,
      parentPath(path),
      nameFromPath(path),
      blobKey,
      bytes.byteLength,
      now,
      now,
    );

    return Result.ok();
  }

  private async readFileInternal(path: string): Promise<WorkspaceReadResult> {
    const parsed = parseWorkspacePath(path, { allowRoot: true });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const entry = this.getEntry(path);
    if (!entry) {
      return Result.err(new PathNotFoundError({ path }));
    }
    if (entry.type === "directory") {
      return Result.err(new IsDirectoryError({ path }));
    }

    const object = await this.env.WORKSPACE_BLOBS.get(entry.blob_key ?? "");
    if (!object) {
      return Result.err(new PathNotFoundError({ path }));
    }

    return Result.ok(new Uint8Array(await object.arrayBuffer()));
  }

  private listInternal(path: string): WorkspaceListResult {
    const parsed = parseWorkspacePath(path, { allowRoot: true });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const entry = this.getEntry(path);
    if (!entry) {
      return Result.err(new PathNotFoundError({ path }));
    }
    if (entry.type === "file") {
      return Result.err(new NotDirectoryError({ path }));
    }

    const entries = this.ctx.storage.sql
      .exec<WorkspaceEntry>(
        `SELECT name, path, type
         FROM entries
         WHERE parent_path = ? AND path != ?
         ORDER BY name`,
        path,
        path,
      )
      .toArray();

    return Result.ok(entries);
  }

  private deleteInternal(path: string): WorkspaceDeleteResult {
    const parsed = parseWorkspacePath(path, { allowRoot: false });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const entry = this.getEntry(path);
    if (!entry) {
      return Result.err(new PathNotFoundError({ path }));
    }
    if (entry.type === "directory" && this.hasChildren(path)) {
      return Result.err(new DirectoryNotEmptyError({ path }));
    }

    this.ctx.storage.sql.exec("DELETE FROM entries WHERE path = ?", path);
    return Result.ok();
  }

  private statInternal(path: string): WorkspaceStatResult {
    const parsed = parseWorkspacePath(path, { allowRoot: true });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const entry = this.getEntry(path);
    if (!entry) {
      return Result.err(new PathNotFoundError({ path }));
    }

    return Result.ok(entryToStat(entry));
  }

  private initializeSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        path TEXT PRIMARY KEY,
        parent_path TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('directory', 'file')),
        blob_key TEXT,
        size INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS entries_parent_name
      ON entries(parent_path, name)
    `);

    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO entries
       (path, parent_path, name, type, blob_key, size, created_at, updated_at)
       VALUES ('/', '/', '', 'directory', NULL, NULL, ?, ?)`,
      now,
      now,
    );
  }

  private validateWriteTarget(path: string): Result<void, WorkspaceWriteError> {
    const parent = this.requireParentDirectory(path);
    if (Result.isError(parent)) {
      return parent;
    }

    const existingEntry = this.getEntry(path);
    if (existingEntry?.type === "directory") {
      return Result.err(new IsDirectoryError({ path }));
    }

    return Result.ok();
  }

  private requireParentDirectory(path: string): Result<void, PathNotFoundError | NotDirectoryError> {
    const parent = parentPath(path);
    const entry = this.getEntry(parent);
    if (!entry) {
      return Result.err(new PathNotFoundError({ path: parent }));
    }
    if (entry.type !== "directory") {
      return Result.err(new NotDirectoryError({ path: parent }));
    }

    return Result.ok();
  }

  private insertDirectory(path: string, now: number): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO entries
       (path, parent_path, name, type, blob_key, size, created_at, updated_at)
       VALUES (?, ?, ?, 'directory', NULL, NULL, ?, ?)`,
      path,
      parentPath(path),
      nameFromPath(path),
      now,
      now,
    );
  }

  private hasChildren(path: string): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM entries WHERE parent_path = ? AND path != ?",
          path,
          path,
        )
        .one().count > 0
    );
  }

  private getEntry(path: string): EntryRow | null {
    return (
      this.ctx.storage.sql
        .exec<EntryRow>(
          "SELECT path, type, blob_key, size, created_at, updated_at FROM entries WHERE path = ?",
          path,
        )
        .toArray()[0] ?? null
    );
  }
}

async function blobKeyFor(contents: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", contents);
  return `blobs/sha256/${hex(new Uint8Array(digest))}`;
}

function entryToStat(entry: EntryRow): WorkspaceStat {
  return {
    path: entry.path,
    type: entry.type,
    size: entry.size,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
