import { Result } from "better-result";
import { DurableObject } from "cloudflare:workers";
import {
  DirectoryNotEmptyError,
  IsDirectoryError,
  NotDirectoryError,
  PathAlreadyExistsError,
  PathNotFoundError,
  RevisionNotFoundError,
  type WorkspaceWriteError,
} from "./errors";
import { nameFromPath, parentPath, parseWorkspacePath } from "./path";
import {
  toRpcResult,
  type WorkspaceCommitResult,
  type WorkspaceCommitRpcResult,
  type WorkspaceDeleteResult,
  type WorkspaceDeleteRpcResult,
  type WorkspaceEntry,
  type WorkspaceListResult,
  type WorkspaceListRpcResult,
  type WorkspaceMkdirResult,
  type WorkspaceMkdirRpcResult,
  type WorkspaceReadOptions,
  type WorkspaceReadResult,
  type WorkspaceReadRpcResult,
  type WorkspaceRevision,
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

type RevisionRow = {
  id: string;
  created_at: number;
};

export class WorkspaceObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initializeSchema();
    });
  }

  async commit(): Promise<WorkspaceCommitRpcResult> {
    return toRpcResult(this.commitInternal());
  }

  async mkdir(path: string): Promise<WorkspaceMkdirRpcResult> {
    return toRpcResult(this.mkdirInternal(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<WorkspaceWriteRpcResult> {
    return toRpcResult(await this.writeFileInternal(path, contents));
  }

  async readFile(path: string, options: WorkspaceReadOptions = {}): Promise<WorkspaceReadRpcResult> {
    return toRpcResult(await this.readFileInternal(path, options));
  }

  async list(path: string, options: WorkspaceReadOptions = {}): Promise<WorkspaceListRpcResult> {
    return toRpcResult(this.listInternal(path, options));
  }

  async delete(path: string): Promise<WorkspaceDeleteRpcResult> {
    return toRpcResult(this.deleteInternal(path));
  }

  async stat(path: string, options: WorkspaceReadOptions = {}): Promise<WorkspaceStatRpcResult> {
    return toRpcResult(this.statInternal(path, options));
  }

  private commitInternal(): WorkspaceCommitResult {
    const revision: WorkspaceRevision = {
      revisionId: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    this.ctx.storage.sql.exec(
      "INSERT INTO revisions (id, created_at) VALUES (?, ?)",
      revision.revisionId,
      revision.createdAt,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO revision_entries
       (revision_id, path, parent_path, name, type, blob_key, size, created_at, updated_at)
       SELECT ?, path, parent_path, name, type, blob_key, size, created_at, updated_at
       FROM entries`,
      revision.revisionId,
    );

    return Result.ok(revision);
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

    if (this.getHeadEntry(path)) {
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

  private async readFileInternal(path: string, options: WorkspaceReadOptions): Promise<WorkspaceReadResult> {
    const parsed = parseWorkspacePath(path, { allowRoot: true });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const revision = this.resolveRevision(options);
    if (Result.isError(revision)) {
      return Result.err(revision.error);
    }

    const entry = this.getEntry(path, revision.value);
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

  private listInternal(path: string, options: WorkspaceReadOptions): WorkspaceListResult {
    const parsed = parseWorkspacePath(path, { allowRoot: true });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const revision = this.resolveRevision(options);
    if (Result.isError(revision)) {
      return Result.err(revision.error);
    }

    const entry = this.getEntry(path, revision.value);
    if (!entry) {
      return Result.err(new PathNotFoundError({ path }));
    }
    if (entry.type === "file") {
      return Result.err(new NotDirectoryError({ path }));
    }

    return Result.ok(this.listEntries(path, revision.value));
  }

  private deleteInternal(path: string): WorkspaceDeleteResult {
    const parsed = parseWorkspacePath(path, { allowRoot: false });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const entry = this.getHeadEntry(path);
    if (!entry) {
      return Result.err(new PathNotFoundError({ path }));
    }
    if (entry.type === "directory" && this.hasHeadChildren(path)) {
      return Result.err(new DirectoryNotEmptyError({ path }));
    }

    this.ctx.storage.sql.exec("DELETE FROM entries WHERE path = ?", path);
    return Result.ok();
  }

  private statInternal(path: string, options: WorkspaceReadOptions): WorkspaceStatResult {
    const parsed = parseWorkspacePath(path, { allowRoot: true });
    if (Result.isError(parsed)) {
      return Result.err(parsed.error);
    }

    const revision = this.resolveRevision(options);
    if (Result.isError(revision)) {
      return Result.err(revision.error);
    }

    const entry = this.getEntry(path, revision.value);
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
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS revision_entries (
        revision_id TEXT NOT NULL,
        path TEXT NOT NULL,
        parent_path TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('directory', 'file')),
        blob_key TEXT,
        size INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (revision_id, path)
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS revision_entries_parent_name
      ON revision_entries(revision_id, parent_path, name)
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

    const existingEntry = this.getHeadEntry(path);
    if (existingEntry?.type === "directory") {
      return Result.err(new IsDirectoryError({ path }));
    }

    return Result.ok();
  }

  private requireParentDirectory(path: string): Result<void, PathNotFoundError | NotDirectoryError> {
    const parent = parentPath(path);
    const entry = this.getHeadEntry(parent);
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

  private resolveRevision(options: WorkspaceReadOptions): Result<string | undefined, RevisionNotFoundError> {
    if (!options.revisionId) {
      return Result.ok(undefined);
    }
    if (!this.getRevision(options.revisionId)) {
      return Result.err(new RevisionNotFoundError({ revisionId: options.revisionId }));
    }

    return Result.ok(options.revisionId);
  }

  private getRevision(revisionId: string): RevisionRow | null {
    return (
      this.ctx.storage.sql
        .exec<RevisionRow>("SELECT id, created_at FROM revisions WHERE id = ?", revisionId)
        .toArray()[0] ?? null
    );
  }

  private listEntries(path: string, revisionId: string | undefined): WorkspaceEntry[] {
    if (revisionId) {
      return this.ctx.storage.sql
        .exec<WorkspaceEntry>(
          `SELECT name, path, type
           FROM revision_entries
           WHERE revision_id = ? AND parent_path = ? AND path != ?
           ORDER BY name`,
          revisionId,
          path,
          path,
        )
        .toArray();
    }

    return this.ctx.storage.sql
      .exec<WorkspaceEntry>(
        `SELECT name, path, type
         FROM entries
         WHERE parent_path = ? AND path != ?
         ORDER BY name`,
        path,
        path,
      )
      .toArray();
  }

  private hasHeadChildren(path: string): boolean {
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

  private getEntry(path: string, revisionId: string | undefined): EntryRow | null {
    if (revisionId) {
      return (
        this.ctx.storage.sql
          .exec<EntryRow>(
            `SELECT path, type, blob_key, size, created_at, updated_at
             FROM revision_entries
             WHERE revision_id = ? AND path = ?`,
            revisionId,
            path,
          )
          .toArray()[0] ?? null
      );
    }

    return this.getHeadEntry(path);
  }

  private getHeadEntry(path: string): EntryRow | null {
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
