export type ArtifactsBindingClient = {
  create?(name: string, opts?: { readOnly?: boolean; description?: string; setDefaultBranch?: string }): Promise<{ name?: string }>;
  get(name: string): Promise<ArtifactsRepoClient>;
  delete(name: string): Promise<boolean>;
};

export type ArtifactsRepoClient = {
  name: string;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }): Promise<{ name: string }>;
};
