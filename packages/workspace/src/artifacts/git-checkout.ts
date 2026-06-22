import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Volume, createFsFromVolume } from "memfs";
import type { WorkspaceObjectClient } from "../workspace-object";
import type { ArtifactsBindingClient } from "./binding";
import { ArtifactsWorkingCopyRefNotFoundError } from "./errors";
import {
  auth,
  describeArtifactsRepo,
  repoStringField,
  type RepoAccess,
} from "./git-access";
import { workingCopyLocalBranch, workingCopyRef } from "./git-path";

export type Fs = ReturnType<typeof createFsFromVolume>;

export type Checkout = {
  fs: Fs;
  dir: string;
  branch: string;
  remoteRef?: string;
  access: RepoAccess;
};

export class GitCheckoutManager {
  constructor(
    private readonly artifacts: ArtifactsBindingClient,
    private readonly workspaceObject: WorkspaceObjectClient,
  ) {}

  async clone(repository: string, scope: "read" | "write"): Promise<Checkout> {
    if (!(await this.repositoryHasCommits(repository))) {
      return this.emptyCheckout(repository, scope, undefined);
    }
    return this.cloneForRemote(repository, scope);
  }

  async cloneForRemote(
    repository: string,
    scope: "read" | "write",
  ): Promise<Checkout> {
    const access = await this.repoAccess(repository, scope);
    const fs = createFsFromVolume(new Volume());
    const dir = "/repo";
    await git.clone({
      fs,
      http,
      dir,
      url: access.remote,
      ref: access.defaultBranch,
      singleBranch: true,
      depth: scope === "read" ? 1 : undefined,
      onAuth: () => auth(access),
    });
    return { fs, dir, branch: access.defaultBranch, access };
  }

  async cloneWorkingCopy(
    baseRepository: string,
    copyId: string,
    scope: "read" | "write",
  ): Promise<Checkout> {
    const copy = await this.workspaceObject.copy(copyId);
    const emptyBaseCopy = copy?.baseRevisionId === undefined;
    const access = await this.repoAccess(baseRepository, scope);
    const fs = createFsFromVolume(new Volume());
    const dir = "/repo";
    const branch = workingCopyLocalBranch(copyId);
    const remoteRef = workingCopyRef(copyId);

    await git.init({ fs, dir, defaultBranch: branch });
    await git.addRemote({ fs, dir, remote: "origin", url: access.remote, force: true });

    let fetched;
    try {
      fetched = await git.fetch({
        fs,
        http,
        dir,
        url: access.remote,
        remoteRef,
        singleBranch: true,
        depth: scope === "read" ? 1 : undefined,
        onAuth: () => auth(access),
      });
    } catch (error) {
      if (emptyBaseCopy) {
        return { fs, dir, branch, remoteRef, access };
      }
      throw new ArtifactsWorkingCopyRefNotFoundError(remoteRef, { cause: error });
    }

    if (!fetched.fetchHead) {
      if (emptyBaseCopy) {
        return { fs, dir, branch, remoteRef, access };
      }
      throw new ArtifactsWorkingCopyRefNotFoundError(remoteRef);
    }

    await git.branch({
      fs,
      dir,
      ref: branch,
      object: fetched.fetchHead,
      checkout: true,
      force: true,
    });
    await git.checkout({ fs, dir, ref: branch, force: true });
    return { fs, dir, branch, remoteRef, access };
  }

  async repositoryHasCommits(repository: string): Promise<boolean> {
    const repo = await this.artifacts.get(repository);
    const log = (repo as { log?: (opts?: { limit?: number }) => Promise<unknown> }).log;
    if (typeof log !== "function") {
      return true;
    }

    const commits = await log({ limit: 1 });
    return Array.isArray(commits) && commits.length > 0;
  }

  async repoAccess(repository: string, scope: "read" | "write"): Promise<RepoAccess> {
    const repo = await this.artifacts.get(repository);
    const current = await this.workspaceObject.currentRepository();
    const recorded = current?.repository === repository ? current : undefined;
    const remote = recorded?.remote ?? repoStringField(repo, "remote");
    const defaultBranch = recorded?.defaultBranch ?? repoStringField(repo, "defaultBranch");
    const name = repoStringField(repo, "name") ?? recorded?.repository ?? repository;
    const createToken = (repo as {
      createToken?: (
        scope: "read" | "write",
        ttl: number,
      ) => Promise<{ plaintext: string }>;
    }).createToken;
    if (!remote || !defaultBranch || typeof createToken !== "function") {
      throw new Error(
        `Artifacts repo does not expose git remote access: ${describeArtifactsRepo(repo)}`,
      );
    }
    const token = (await createToken(scope, 60 * 60)).plaintext;
    return { name, remote, defaultBranch, token };
  }

  private async emptyCheckout(
    repository: string,
    scope: "read" | "write",
    branch: string | undefined,
  ): Promise<Checkout> {
    const access = await this.repoAccess(repository, scope);
    const fs = createFsFromVolume(new Volume());
    const dir = "/repo";
    const checkoutBranch = branch ?? access.defaultBranch;
    await git.init({ fs, dir, defaultBranch: checkoutBranch });
    return { fs, dir, branch: checkoutBranch, access };
  }
}
