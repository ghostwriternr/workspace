import type { Result } from "better-result";
import type {
  WorkspaceDeleteError,
  WorkspaceListError,
  WorkspaceReadError,
  WorkspaceWriteError,
} from "./workspace-error";

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export interface WorkspaceStore {
  writeFile(path: string, contents: Uint8Array): Promise<Result<void, WorkspaceWriteError>>;
  readFile(path: string): Promise<Result<Uint8Array, WorkspaceReadError>>;
  list(path: string): Promise<Result<WorkspaceEntry[], WorkspaceListError>>;
  delete(path: string): Promise<Result<void, WorkspaceDeleteError>>;
}
