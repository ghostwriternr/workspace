import { DurableObject } from "cloudflare:workers";

export type WorkspaceRepositoryAccess = {
  repository: string;
  remote: string;
  defaultBranch: string;
  baseRepository?: string;
  baseRevisionId?: string;
};

export type WorkspaceCurrentRepositoryRecord = {
  repository: string;
  remote: string;
  defaultBranch: string;
};

export type WorkspaceCopyRepositoryRecord = {
  copyId: string;
  baseRepository: string;
  remote: string;
  defaultBranch: string;
  baseRevisionId?: string;
};

export type WorkspaceObjectClient = {
  recordCurrentRepository(record: WorkspaceCurrentRepositoryRecord): Promise<void>;
  recordCopy(record: WorkspaceCopyRepositoryRecord): Promise<void>;
  repositoryAccess(repository: string): Promise<WorkspaceRepositoryAccess | undefined>;
  deleteCopy(copyId: string): Promise<void>;
};

export class WorkspaceObject extends DurableObject<Record<string, never>> {
  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    this.migrate();
  }

  recordCurrentRepository(record: WorkspaceCurrentRepositoryRecord): void {
    this.upsertRepository({
      repository: record.repository,
      role: "current",
      baseRepository: null,
      remote: record.remote,
      defaultBranch: record.defaultBranch,
      baseRevisionId: null,
    });
  }

  recordCopy(record: WorkspaceCopyRepositoryRecord): void {
    this.upsertRepository({
      repository: record.copyId,
      role: "copy",
      baseRepository: record.baseRepository,
      remote: record.remote,
      defaultBranch: record.defaultBranch,
      baseRevisionId: record.baseRevisionId ?? null,
    });
  }

  repositoryAccess(repository: string): WorkspaceRepositoryAccess | undefined {
    const row = this.ctx.storage.sql.exec<RepositoryRow>(
      `SELECT repository, base_repository, remote, default_branch, base_revision_id
         FROM repositories
        WHERE repository = ?`,
      repository,
    ).toArray()[0];

    if (!row) {
      return undefined;
    }

    return {
      repository: row.repository,
      remote: row.remote,
      defaultBranch: row.default_branch,
      ...(row.base_repository ? { baseRepository: row.base_repository } : {}),
      ...(row.base_revision_id ? { baseRevisionId: row.base_revision_id } : {}),
    };
  }

  deleteCopy(copyId: string): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM repositories WHERE repository = ? AND role = 'copy'`,
      copyId,
    );
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        repository TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('current', 'copy')),
        base_repository TEXT,
        remote TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        base_revision_id TEXT
      )
    `);
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE repositories ADD COLUMN base_revision_id TEXT`);
    } catch {
      // Column already exists in objects created before this schema version.
    }
  }

  private upsertRepository(record: {
    repository: string;
    role: "current" | "copy";
    baseRepository: string | null;
    remote: string;
    defaultBranch: string;
    baseRevisionId: string | null;
  }): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO repositories (
         repository, role, base_repository, remote, default_branch, created_at, updated_at, base_revision_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repository) DO UPDATE SET
         role = excluded.role,
         base_repository = excluded.base_repository,
         remote = excluded.remote,
         default_branch = excluded.default_branch,
         updated_at = excluded.updated_at,
         base_revision_id = excluded.base_revision_id`,
      record.repository,
      record.role,
      record.baseRepository,
      record.remote,
      record.defaultBranch,
      now,
      now,
      record.baseRevisionId,
    );
  }
}

type RepositoryRow = {
  repository: string;
  base_repository: string | null;
  remote: string;
  default_branch: string;
  base_revision_id: string | null;
};
