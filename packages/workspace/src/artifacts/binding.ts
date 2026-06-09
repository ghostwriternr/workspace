export type ArtifactsRepositoryResult = {
  id?: string;
  name: string;
  remote?: string;
  defaultBranch?: string;
  token?: string;
};

export type ArtifactsBindingClient = {
  create?(name: string, opts?: { readOnly?: boolean; description?: string; setDefaultBranch?: string }): Promise<ArtifactsRepositoryResult>;
  get(name: string): Promise<ArtifactsRepoClient>;
  delete(name: string): Promise<boolean>;
};

export type ArtifactsRepoClient = {
  name: string;
};
