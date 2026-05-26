import { nameFromPath, parentPath } from "../model/path";
import type { BlobRef, EntryRow, MutableTree, ReadableTree } from "./tree";
import type { WorkspaceEntry } from "../model/rpc";

type SqlStorage = DurableObjectStorage["sql"];

type EntryTableDescriptor =
  | { tableName: "entries"; targetColumn?: undefined; targetId?: undefined }
  | { tableName: "revision_entries" | "session_entries"; targetColumn: "revision_id" | "session_id"; targetId: string };

export class SqlReadableTree implements ReadableTree {
  constructor(
    protected readonly sql: SqlStorage,
    protected readonly descriptor: EntryTableDescriptor,
  ) {}

  getEntry(path: string): EntryRow | null {
    const scope = this.scopeWhere("path = ?", [path]);
    return (
      this.sql
        .exec<EntryRow>(
          `SELECT path, parent_path, name, type, blob_key, size, created_at, updated_at
           FROM ${this.descriptor.tableName}
           WHERE ${scope.where}`,
          ...scope.params,
        )
        .toArray()[0] ?? null
    );
  }

  listChildren(path: string): WorkspaceEntry[] {
    const scope = this.scopeWhere("parent_path = ? AND path != ?", [path, path]);
    return this.sql
      .exec<WorkspaceEntry>(
        `SELECT name, path, type
         FROM ${this.descriptor.tableName}
         WHERE ${scope.where}
         ORDER BY name`,
        ...scope.params,
      )
      .toArray();
  }

  protected scopeWhere(where: string, params: unknown[]): { where: string; params: unknown[] } {
    if (!this.descriptor.targetColumn) {
      return { where, params };
    }

    return {
      where: `${this.descriptor.targetColumn} = ? AND ${where}`,
      params: [this.descriptor.targetId, ...params],
    };
  }
}

export class SqlMutableTree extends SqlReadableTree implements MutableTree {
  putDirectory(path: string, now: number): void {
    this.insertEntry(path, "directory", null, null, now);
  }

  putFile(path: string, blob: BlobRef, now: number): void {
    this.insertEntry(path, "file", blob.blobKey, blob.size, now);
  }

  deleteEntry(path: string): void {
    const scope = this.scopeWhere("path = ?", [path]);
    this.sql.exec(`DELETE FROM ${this.descriptor.tableName} WHERE ${scope.where}`, ...scope.params);
  }

  hasChildren(path: string): boolean {
    const scope = this.scopeWhere("parent_path = ? AND path != ?", [path, path]);
    return (
      this.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM ${this.descriptor.tableName}
           WHERE ${scope.where}`,
          ...scope.params,
        )
        .one().count > 0
    );
  }

  private insertEntry(
    path: string,
    type: "directory" | "file",
    blobKey: string | null,
    size: number | null,
    now: number,
  ): void {
    if (this.descriptor.targetColumn) {
      this.sql.exec(
        `INSERT INTO ${this.descriptor.tableName}
         (${this.descriptor.targetColumn}, path, parent_path, name, type, blob_key, size, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(${this.descriptor.targetColumn}, path) DO UPDATE SET
           type = excluded.type,
           blob_key = excluded.blob_key,
           size = excluded.size,
           updated_at = excluded.updated_at`,
        this.descriptor.targetId,
        path,
        parentPath(path),
        nameFromPath(path),
        type,
        blobKey,
        size,
        now,
        now,
      );
      return;
    }

    this.sql.exec(
      `INSERT INTO ${this.descriptor.tableName}
       (path, parent_path, name, type, blob_key, size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         type = excluded.type,
         blob_key = excluded.blob_key,
         size = excluded.size,
         updated_at = excluded.updated_at`,
      path,
      parentPath(path),
      nameFromPath(path),
      type,
      blobKey,
      size,
      now,
      now,
    );
  }
}

export function headTree(sql: SqlStorage): MutableTree {
  return new SqlMutableTree(sql, { tableName: "entries" });
}

export function revisionTree(sql: SqlStorage, revisionId: string): ReadableTree {
  return new SqlReadableTree(sql, {
    tableName: "revision_entries",
    targetColumn: "revision_id",
    targetId: revisionId,
  });
}

export function sessionTree(sql: SqlStorage, sessionId: string): MutableTree {
  return new SqlMutableTree(sql, {
    tableName: "session_entries",
    targetColumn: "session_id",
    targetId: sessionId,
  });
}
