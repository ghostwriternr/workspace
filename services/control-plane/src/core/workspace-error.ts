export type WorkspaceErrorCode =
  | "invalid_path"
  | "is_directory"
  | "not_directory"
  | "not_found";

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}
