export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export type WorkspaceStat = {
  path: string;
  type: "directory" | "file";
  size: number | null;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceRevision = {
  revisionId: string;
  createdAt: number;
};
