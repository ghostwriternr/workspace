import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Volume, createFsFromVolume } from "memfs";
import type { WorkspaceEntry, WorkspaceRevision, WorkspaceStat } from "../model/entries";
import type { WorkspaceObjectClient } from "../workspace-object";
import type { ArtifactsWorkspaceDriver, ArtifactsWorkspaceFileWrite } from "./authority";
import type { ArtifactsBindingClient, ArtifactsRepoClient } from "./binding";

const textEncoder = new TextEncoder();
const EMPTY_REPOSITORY_REVISION_ID = "empty-repository";

type RepoAccess = {
  name: string;
  remote: string;
  defaultBranch: string;
  token: string;
};

type Fs = ReturnType<typeof createFsFromVolume>;

export function createIsomorphicGitArtifactsWorkspaceDriver(
  artifacts: ArtifactsBindingClient,
  workspaceObject: WorkspaceObjectClient,
): ArtifactsWorkspaceDriver {
  return new IsomorphicGitArtifactsWorkspaceDriver(artifacts, workspaceObject);
}

class IsomorphicGitArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  constructor(
    private readonly artifacts: ArtifactsBindingClient,
    private readonly workspaceObject: WorkspaceObjectClient,
  ) {}

  async repositoryExists(repository: string): Promise<boolean> {
    try {
      await this.artifacts.get(repository);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    const checkout = await this.clone(repository, "read");
    const rel = relativeGitPath(path);
    if (!rel) return null;
    try {
      const contents = await checkout.fs.promises.readFile(`${checkout.dir}/${rel}`);
      return contents instanceof Uint8Array ? new Uint8Array(contents) : textEncoder.encode(String(contents));
    } catch {
      return null;
    }
  }

  async list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    return entriesFromFiles(await this.listFiles(repository), path);
  }

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    return statFromFiles(path, await this.listFiles(repository), (filePath) =>
      this.readFile(repository, filePath),
    );
  }

  async writeFile(repository: string, path: string, contents: Uint8Array): Promise<void> {
    await this.writeFiles(repository, [{ path, contents }]);
  }

  async writeFiles(repository: string, files: ArtifactsWorkspaceFileWrite[]): Promise<void> {
    if (files.length === 0) return;

    const checkout = await this.clone(repository, "write");
    for (const file of files) {
      const rel = relativeGitPath(file.path);
      await mkdirp(checkout.fs, dirname(`${checkout.dir}/${rel}`));
      await checkout.fs.promises.writeFile(`${checkout.dir}/${rel}`, file.contents);
      await git.add({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
    }
    await this.commitAndPush(checkout, `Update ${files.length === 1 ? relativeGitPath(files[0]!.path) : `${files.length} files`}`);
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    const checkout = await this.clone(repository, "write");
    const rel = relativeGitPath(path);
    await checkout.fs.promises.unlink(`${checkout.dir}/${rel}`);
    await git.remove({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
    await this.commitAndPush(checkout, `Delete ${rel}`);
  }

  async currentRevision(repository: string): Promise<string | undefined> {
    if (!(await this.repositoryHasCommits(repository))) return undefined;
    const checkout = await this.clone(repository, "read");
    return await git.resolveRef({ fs: checkout.fs, dir: checkout.dir, ref: "HEAD" });
  }

  async createWorkingCopy(baseRepository: string, copyId: string): Promise<string | undefined> {
    if (!(await this.repositoryHasCommits(baseRepository))) return undefined;

    const checkout = await this.clone(baseRepository, "write");
    await git.push({
      fs: checkout.fs,
      http,
      dir: checkout.dir,
      url: checkout.access.remote,
      ref: checkout.branch,
      remoteRef: workingCopyRef(copyId),
      force: true,
      onAuth: () => auth(checkout.access),
    });
    return await git.resolveRef({ fs: checkout.fs, dir: checkout.dir, ref: "HEAD" });
  }

  async readWorkingCopyFile(baseRepository: string, copyId: string, path: string): Promise<Uint8Array | null> {
    const checkout = await this.cloneWorkingCopy(baseRepository, copyId, "read");
    const rel = relativeGitPath(path);
    if (!rel) return null;
    try {
      const contents = await checkout.fs.promises.readFile(`${checkout.dir}/${rel}`);
      return contents instanceof Uint8Array ? new Uint8Array(contents) : textEncoder.encode(String(contents));
    } catch {
      return null;
    }
  }

  async listWorkingCopy(baseRepository: string, copyId: string, path: string): Promise<WorkspaceEntry[]> {
    const files = await this.listWorkingCopyFiles(baseRepository, copyId);
    return entriesFromFiles(files, path);
  }

  async statWorkingCopy(baseRepository: string, copyId: string, path: string): Promise<WorkspaceStat | null> {
    return statFromFiles(path, await this.listWorkingCopyFiles(baseRepository, copyId), (filePath) =>
      this.readWorkingCopyFile(baseRepository, copyId, filePath),
    );
  }

  async writeWorkingCopyFile(baseRepository: string, copyId: string, path: string, contents: Uint8Array): Promise<void> {
    await this.writeWorkingCopyFiles(baseRepository, copyId, [{ path, contents }]);
  }

  async writeWorkingCopyFiles(baseRepository: string, copyId: string, files: ArtifactsWorkspaceFileWrite[]): Promise<void> {
    if (files.length === 0) return;

    const checkout = await this.cloneWorkingCopy(baseRepository, copyId, "write");
    for (const file of files) {
      const rel = relativeGitPath(file.path);
      await mkdirp(checkout.fs, dirname(`${checkout.dir}/${rel}`));
      await checkout.fs.promises.writeFile(`${checkout.dir}/${rel}`, file.contents);
      await git.add({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
    }
    await this.commitAndPush(checkout, `Update ${files.length === 1 ? relativeGitPath(files[0]!.path) : `${files.length} files`}`);
  }

  async deleteWorkingCopyFile(baseRepository: string, copyId: string, path: string): Promise<void> {
    const checkout = await this.cloneWorkingCopy(baseRepository, copyId, "write");
    const rel = relativeGitPath(path);
    await checkout.fs.promises.unlink(`${checkout.dir}/${rel}`);
    await git.remove({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
    await this.commitAndPush(checkout, `Delete ${rel}`);
  }

  async applyWorkingCopy(baseRepository: string, copyId: string): Promise<WorkspaceRevision> {
    const checkout = await this.cloneWorkingCopy(baseRepository, copyId, "write");
    const base = await this.repoAccess(baseRepository, "write");
    const revisionId = await headRevision(checkout);
    if (!revisionId) {
      return { revisionId: EMPTY_REPOSITORY_REVISION_ID, createdAt: Date.now() };
    }
    await git.push({
      fs: checkout.fs,
      http,
      dir: checkout.dir,
      url: base.remote,
      ref: checkout.branch,
      remoteRef: base.defaultBranch,
      force: false,
      onAuth: () => auth(base),
    });
    return { revisionId, createdAt: Date.now() };
  }

  async discardWorkingCopy(baseRepository: string, copyId: string): Promise<void> {
    const checkout = await this.cloneForRemote(baseRepository, "write");
    await git.push({
      fs: checkout.fs,
      http,
      dir: checkout.dir,
      url: checkout.access.remote,
      ref: checkout.branch,
      remoteRef: workingCopyRef(copyId),
      delete: true,
      onAuth: () => auth(checkout.access),
    });
  }

  private async listFiles(repository: string): Promise<string[]> {
    const checkout = await this.clone(repository, "read");
    return git.listFiles({ fs: checkout.fs, dir: checkout.dir });
  }

  private async listWorkingCopyFiles(baseRepository: string, copyId: string): Promise<string[]> {
    const checkout = await this.cloneWorkingCopy(baseRepository, copyId, "read");
    return git.listFiles({ fs: checkout.fs, dir: checkout.dir });
  }

  private async commitAndPush(checkout: Checkout, message: string): Promise<void> {
    await git.commit({
      fs: checkout.fs,
      dir: checkout.dir,
      message,
      author: { name: "Cloudflare Workspace", email: "workspace@cloudflare.com" },
    });
    await git.push({
      fs: checkout.fs,
      http,
      dir: checkout.dir,
      url: checkout.access.remote,
      ref: checkout.branch,
      remoteRef: checkout.remoteRef ?? checkout.branch,
      onAuth: () => auth(checkout.access),
    });
  }

  private async clone(repository: string, scope: "read" | "write"): Promise<Checkout> {
    if (!(await this.repositoryHasCommits(repository))) {
      return this.emptyCheckout(repository, scope, undefined);
    }
    return this.cloneForRemote(repository, scope);
  }

  private async cloneForRemote(repository: string, scope: "read" | "write"): Promise<Checkout> {
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

  private async emptyCheckout(repository: string, scope: "read" | "write", branch: string | undefined): Promise<Checkout> {
    const access = await this.repoAccess(repository, scope);
    const fs = createFsFromVolume(new Volume());
    const dir = "/repo";
    const checkoutBranch = branch ?? access.defaultBranch;
    await git.init({ fs, dir, defaultBranch: checkoutBranch });
    return { fs, dir, branch: checkoutBranch, access };
  }

  private async cloneWorkingCopy(baseRepository: string, copyId: string, scope: "read" | "write"): Promise<Checkout> {
    const copyAccess = await this.workspaceObject.repositoryAccess(copyId);
    const emptyBaseCopy = copyAccess?.baseRevisionId === undefined;
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
      throw error;
    }
    if (!fetched.fetchHead) {
      if (emptyBaseCopy) {
        return { fs, dir, branch, remoteRef, access };
      }
      throw new Error(`Could not fetch Workspace working copy ref: ${remoteRef}`);
    }
    await git.branch({ fs, dir, ref: branch, object: fetched.fetchHead, checkout: true, force: true });
    await git.checkout({ fs, dir, ref: branch, force: true });
    return { fs, dir, branch, remoteRef, access };
  }


  private async repositoryHasCommits(repository: string): Promise<boolean> {
    const repo = await this.artifacts.get(repository);
    const log = (repo as { log?: (opts?: { limit?: number }) => Promise<unknown> }).log;
    if (typeof log !== "function") {
      return true;
    }

    const commits = await log({ limit: 1 });
    return Array.isArray(commits) && commits.length > 0;
  }

  private async repoAccess(repository: string, scope: "read" | "write"): Promise<RepoAccess> {
    const repo = await this.artifacts.get(repository);
    const recorded = await this.workspaceObject.repositoryAccess(repository);
    const remote = recorded?.remote ?? repoStringField(repo, "remote");
    const defaultBranch = recorded?.defaultBranch ?? repoStringField(repo, "defaultBranch");
    const name = repoStringField(repo, "name") ?? recorded?.repository ?? repository;
    const createToken = (repo as { createToken?: (scope: "read" | "write", ttl: number) => Promise<{ plaintext: string }> }).createToken;
    if (!remote || !defaultBranch || typeof createToken !== "function") {
      throw new Error(`Artifacts repo does not expose git remote access: ${describeArtifactsRepo(repo)}`);
    }
    const token = (await createToken(scope, 60 * 60)).plaintext;
    return {
      name,
      remote,
      defaultBranch,
      token,
    };
  }
}

type Checkout = {
  fs: Fs;
  dir: string;
  branch: string;
  remoteRef?: string;
  access: RepoAccess;
};

function describeArtifactsRepo(repo: ArtifactsRepoClient): string {
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

function repoStringField(repo: ArtifactsRepoClient, field: "name" | "remote" | "defaultBranch"): string | undefined {
  const value = (repo as unknown as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function auth(access: RepoAccess): { username: string; password: string } {
  return { username: "x-access-token", password: access.token };
}

function entriesFromFiles(files: string[], path: string): WorkspaceEntry[] {
  const prefix = path === "/" ? "" : `${relativeGitPath(path)}/`;
  const entries = new Map<string, "directory" | "file">();

  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rest = file.slice(prefix.length);
    if (!rest) continue;
    const [name, ...remaining] = rest.split("/");
    entries.set(name, remaining.length === 0 ? "file" : "directory");
  }

  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, type]) => ({
      name,
      path: path === "/" ? `/${name}` : `${path}/${name}`,
      type,
    }));
}

async function statFromFiles(
  path: string,
  files: string[],
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<WorkspaceStat | null> {
  const now = Date.now();
  if (path === "/") {
    return { path, type: "directory", size: null, createdAt: now, updatedAt: now };
  }

  const rel = relativeGitPath(path);
  if (files.includes(rel)) {
    const contents = await read(path);
    return { path, type: "file", size: contents?.byteLength ?? 0, createdAt: now, updatedAt: now };
  }

  const prefix = `${rel}/`;
  if (files.some((file) => file.startsWith(prefix))) {
    return { path, type: "directory", size: null, createdAt: now, updatedAt: now };
  }

  return null;
}

function relativeGitPath(path: string): string {
  return path.replace(/^\/+/, "");
}

function workingCopyRef(copyId: string): string {
  return `refs/workspace/copies/${copyId}`;
}

function workingCopyLocalBranch(copyId: string): string {
  return `workspace/copies/${copyId}`;
}

async function headRevision(checkout: Checkout): Promise<string | undefined> {
  try {
    return await git.resolveRef({ fs: checkout.fs, dir: checkout.dir, ref: "HEAD" });
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") {
      return undefined;
    }
    throw error;
  }
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

async function mkdirp(fs: Fs, path: string): Promise<void> {
  if (path === "/") return;
  await fs.promises.mkdir(path, { recursive: true });
}
