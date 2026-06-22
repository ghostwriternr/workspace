import type { ArtifactsRepoClient } from "./binding";

export type RepoAccess = {
  name: string;
  remote: string;
  defaultBranch: string;
  token: string;
};

export function auth(access: RepoAccess): { username: string; password: string } {
  return { username: "x-access-token", password: access.token };
}

export function describeArtifactsRepo(repo: ArtifactsRepoClient): string {
  return JSON.stringify({
    keys: Object.keys(repo),
    name: repo.name,
    remoteType: typeof (repo as { remote?: unknown }).remote,
    defaultBranchType: typeof (repo as { defaultBranch?: unknown }).defaultBranch,
    createTokenType: typeof (repo as { createToken?: unknown }).createToken,
    fileType: typeof (repo as { file?: unknown }).file,
    logType: typeof (repo as { log?: unknown }).log,
  });
}

export function repoStringField(
  repo: ArtifactsRepoClient,
  field: "name" | "remote" | "defaultBranch",
): string | undefined {
  const value = (repo as unknown as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}
