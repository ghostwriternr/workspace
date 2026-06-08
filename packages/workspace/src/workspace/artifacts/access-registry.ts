export type ArtifactsRepositoryAccess = {
  name: string;
  remote: string;
  defaultBranch: string;
  token: string;
};

const accessByRepository = new Map<string, ArtifactsRepositoryAccess>();

export function registerArtifactsRepositoryAccess(access: ArtifactsRepositoryAccess): void {
  accessByRepository.set(access.name, access);
}

export function getArtifactsRepositoryAccess(name: string): ArtifactsRepositoryAccess | undefined {
  const access = accessByRepository.get(name);
  return access ? { ...access } : undefined;
}
