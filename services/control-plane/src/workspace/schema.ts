type SqlStorage = DurableObjectStorage["sql"];

export function initializeWorkspaceSchema(sql: SqlStorage, now = Date.now()): void {
  sql.exec(`
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
  sql.exec(`
    CREATE INDEX IF NOT EXISTS entries_parent_name
    ON entries(parent_path, name)
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )
  `);
  sql.exec(`
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
  sql.exec(`
    CREATE INDEX IF NOT EXISTS revision_entries_parent_name
    ON revision_entries(revision_id, parent_path, name)
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open', 'committed', 'discarded'))
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS session_entries (
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      parent_path TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('directory', 'file')),
      blob_key TEXT,
      size INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, path)
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS session_entries_parent_name
    ON session_entries(session_id, parent_path, name)
  `);

  sql.exec(
    `INSERT OR IGNORE INTO entries
     (path, parent_path, name, type, blob_key, size, created_at, updated_at)
     VALUES ('/', '/', '', 'directory', NULL, NULL, ?, ?)`,
    now,
    now,
  );
}
