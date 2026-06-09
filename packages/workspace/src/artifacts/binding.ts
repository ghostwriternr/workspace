export type ArtifactsRepositoryResult = ArtifactsCreateRepoResult;
export type ArtifactsRepoClient = ArtifactsRepo;
export type ArtifactsImportBindingClient = Pick<Artifacts, "import">;

export type ArtifactsBindingClient = Pick<Artifacts, "get" | "delete"> &
  Partial<Pick<Artifacts, "create" | "import">>;
