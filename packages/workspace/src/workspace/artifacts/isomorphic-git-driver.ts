import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Volume, createFsFromVolume } from "memfs";
import { getArtifactsRepositoryAccess } from "./access-registry";
import type { WorkspaceEntry, WorkspaceRevision, WorkspaceStat } from "../model/rpc";
import type { ArtifactsBindingClient, ArtifactsRepoClient, ArtifactsWorkspaceDriver } from "./workspace-object-client";

const textEncoder = new TextEncoder();

type RepoAccess = {
  name: string;
  remote: string;
  defaultBranch: string;
  token: string;
};

type Fs = ReturnType<typeof createFsFromVolume>;

export function createIsomorphicGitArtifactsWorkspaceDriver(artifacts: ArtifactsBindingClient): ArtifactsWorkspaceDriver {
  return new IsomorphicGitArtifactsWorkspaceDriver(artifacts);
}

class IsomorphicGitArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  constructor(private readonly artifacts: ArtifactsBindingClient) {}

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
    const files = await this.listFiles(repository);
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

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    const files = await this.listFiles(repository);
    const now = Date.now();
    if (path === "/") {
      return { path, type: "directory", size: null, createdAt: now, updatedAt: now };
    }

    const rel = relativeGitPath(path);
    if (files.includes(rel)) {
      const contents = await this.readFile(repository, path);
      return { path, type: "file", size: contents?.byteLength ?? 0, createdAt: now, updatedAt: now };
    }

    const prefix = `${rel}/`;
    if (files.some((file) => file.startsWith(prefix))) {
      return { path, type: "directory", size: null, createdAt: now, updatedAt: now };
    }

    return null;
  }

  async writeFile(repository: string, path: string, contents: Uint8Array): Promise<void> {
    const checkout = await this.clone(repository, "write");
    const rel = relativeGitPath(path);
    await mkdirp(checkout.fs, dirname(`${checkout.dir}/${rel}`));
    await checkout.fs.promises.writeFile(`${checkout.dir}/${rel}`, contents);
    await git.add({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
    await this.commitAndPush(checkout, `Update ${rel}`);
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    const checkout = await this.clone(repository, "write");
    const rel = relativeGitPath(path);
    await checkout.fs.promises.unlink(`${checkout.dir}/${rel}`);
    await git.remove({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
    await this.commitAndPush(checkout, `Delete ${rel}`);
  }

  async applyWorkingCopy(baseRepository: string, workingCopyRepository: string): Promise<WorkspaceRevision> {
    const checkout = await this.clone(workingCopyRepository, "write");
    const base = await this.repoAccess(baseRepository, "write");
    const revisionId = await git.resolveRef({ fs: checkout.fs, dir: checkout.dir, ref: "HEAD" });
    await git.push({
      fs: checkout.fs,
      http,
      dir: checkout.dir,
      url: base.remote,
      ref: checkout.branch,
      remoteRef: base.defaultBranch,
      force: true,
      onAuth: () => auth(base),
    });
    return { revisionId, createdAt: Date.now() };
  }

  private async listFiles(repository: string): Promise<string[]> {
    const checkout = await this.clone(repository, "read");
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
      ref: checkout.branch,
      remoteRef: checkout.branch,
      onAuth: () => auth(checkout.access),
    });
  }

  private async clone(repository: string, scope: "read" | "write"): Promise<Checkout> {
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

  private async repoAccess(repository: string, scope: "read" | "write"): Promise<RepoAccess> {
    const registered = getArtifactsRepositoryAccess(repository);
    if (registered) {
      return registered;
    }

    const repo = await this.artifacts.get(repository);
    const remote = await repoStringField(repo, "remote");
    const defaultBranch = await repoStringField(repo, "defaultBranch");
    const name = await repoStringField(repo, "name") ?? repository;
    const createToken = (repo as { createToken?: unknown }).createToken;
    if (!remote || !defaultBranch || typeof createToken !== "function") {
      throw new Error(`Artifacts repo does not expose git remote access: ${describeArtifactsRepo(repo)}`);
    }
    const token = await createToken.call(repo, scope, 60 * 60) as { plaintext: string };
    return {
      name,
      remote,
      defaultBranch,
      token: token.plaintext,
    };
  }
}

type Checkout = {
  fs: Fs;
  dir: string;
  branch: string;
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

async function repoStringField(repo: ArtifactsRepoClient, field: "name" | "remote" | "defaultBranch"): Promise<string | undefined> {
  const value = (repo as unknown as Record<string, unknown>)[field];
  if (typeof value === "string") return value;
  if (typeof value === "function") {
    const result = await value.call(repo) as unknown;
    return typeof result === "string" ? result : undefined;
  }
  return undefined;
}

function auth(access: RepoAccess): { username: string; password: string } {
  return { username: "x-access-token", password: access.token };
}

function relativeGitPath(path: string): string {
  return path.replace(/^\/+/, "");
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

async function mkdirp(fs: Fs, path: string): Promise<void> {
  if (path === "/") return;
  await fs.promises.mkdir(path, { recursive: true });
}
