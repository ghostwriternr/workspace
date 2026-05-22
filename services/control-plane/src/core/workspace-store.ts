export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export interface WorkspaceStore {
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  list(path: string): Promise<WorkspaceEntry[]>;
  delete(path: string): Promise<void>;
}
