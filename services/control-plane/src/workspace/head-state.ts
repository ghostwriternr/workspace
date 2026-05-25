type SqlStorage = DurableObjectStorage["sql"];

export function getHeadVersion(sql: SqlStorage): number {
  return sql.exec<{ head_version: number }>("SELECT head_version FROM workspace_state WHERE id = 1").one()
    .head_version;
}

export function bumpHeadVersion(sql: SqlStorage): number {
  sql.exec(
    "UPDATE workspace_state SET head_version = head_version + 1, updated_at = ? WHERE id = 1",
    Date.now(),
  );
  return getHeadVersion(sql);
}
