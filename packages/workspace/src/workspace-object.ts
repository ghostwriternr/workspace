import { DurableObject } from "cloudflare:workers";

export type WorkspaceCurrentRepositoryRecord = {
  repository: string;
  remote: string;
  defaultBranch: string;
};

export type WorkspaceCopyRecord = {
  copyId: string;
  label?: string;
  createdAt: number;
  baseRepository: string;
  baseRevisionId?: string;
};

export type WorkspaceObjectClient = {
  recordCurrentRepository(record: WorkspaceCurrentRepositoryRecord): Promise<void>;
  currentRepository(): Promise<WorkspaceCurrentRepositoryRecord | undefined>;
  recordCopy(record: WorkspaceCopyRecord): Promise<void>;
  copy(copyId: string): Promise<WorkspaceCopyRecord | undefined>;
  deleteCopy(copyId: string): Promise<void>;
};

export class WorkspaceObject extends DurableObject<Record<string, never>> {
  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    this.migrate();
  }

  recordCurrentRepository(record: WorkspaceCurrentRepositoryRecord): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO current_repository (
         id, repository, remote, default_branch, created_at, updated_at
       ) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         repository = excluded.repository,
         remote = excluded.remote,
         default_branch = excluded.default_branch,
         updated_at = excluded.updated_at`,
      record.repository,
      record.remote,
      record.defaultBranch,
      now,
      now,
    );
  }

  currentRepository(): WorkspaceCurrentRepositoryRecord | undefined {
    const row = this.ctx.storage.sql.exec<CurrentRepositoryRow>(
      `SELECT repository, remote, default_branch
         FROM current_repository
        WHERE id = 1`,
    ).toArray()[0];

    if (!row) return undefined;
    return {
      repository: row.repository,
      remote: row.remote,
      defaultBranch: row.default_branch,
    };
  }

  recordCopy(record: WorkspaceCopyRecord): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO workspace_copies (
         copy_id,
         label,
         base_repository,
         created_at,
         updated_at,
         base_revision_id
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(copy_id) DO UPDATE SET
         label = excluded.label,
         base_repository = excluded.base_repository,
         updated_at = excluded.updated_at,
         base_revision_id = excluded.base_revision_id`,
      record.copyId,
      record.label ?? null,
      record.baseRepository,
      record.createdAt,
      now,
      record.baseRevisionId ?? null,
    );
  }

  copy(copyId: string): WorkspaceCopyRecord | undefined {
    const row = this.ctx.storage.sql.exec<CopyRow>(
      `SELECT copy_id, label, created_at, base_repository, base_revision_id
         FROM workspace_copies
        WHERE copy_id = ?`,
      copyId,
    ).toArray()[0];

    if (!row) return undefined;
    return {
      copyId: row.copy_id,
      ...(row.label ? { label: row.label } : {}),
      createdAt: row.created_at,
      baseRepository: row.base_repository,
      ...(row.base_revision_id ? { baseRevisionId: row.base_revision_id } : {}),
    };
  }

  deleteCopy(copyId: string): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM workspace_copies WHERE copy_id = ?`,
      copyId,
    );
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS current_repository (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        repository TEXT NOT NULL,
        remote TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS workspace_copies (
        copy_id TEXT PRIMARY KEY,
        label TEXT,
        base_repository TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        base_revision_id TEXT
      )
    `);
  }
}

type CurrentRepositoryRow = {
  repository: string;
  remote: string;
  default_branch: string;
};

type CopyRow = {
  copy_id: string;
  label: string | null;
  created_at: number;
  base_repository: string;
  base_revision_id: string | null;
};
