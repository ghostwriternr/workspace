import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import type { WorkspaceEntry, WorkspaceRevision, WorkspaceStat } from "../model/entries";
import type { WorkspaceObjectClient } from "../workspace-object";
import type { ArtifactsWorkspaceDriver } from "./driver";
import type { ArtifactsWorkspaceFileWrite } from "./file-target";
import type { ArtifactsBindingClient } from "./binding";
import { ArtifactsWorkingCopyRefNotFoundError } from "./errors";
import { auth } from "./git-access";
import { GitCheckoutManager, type Checkout, type Fs } from "./git-checkout";
import { dirname, relativeGitPath, workingCopyRef } from "./git-path";
import { entriesFromFiles, statFromFiles } from "./git-tree";

const textEncoder = new TextEncoder();
const EMPTY_REPOSITORY_REVISION_ID = "empty-repository";

export function createIsomorphicGitArtifactsWorkspaceDriver(
  artifacts: ArtifactsBindingClient,
  workspaceObject: WorkspaceObjectClient,
): ArtifactsWorkspaceDriver {
  return new IsomorphicGitArtifactsWorkspaceDriver(artifacts, workspaceObject);
}

class IsomorphicGitArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  private readonly checkouts: GitCheckoutManager;

  constructor(
    artifacts: ArtifactsBindingClient,
    workspaceObject: WorkspaceObjectClient,
  ) {
    this.checkouts = new GitCheckoutManager(artifacts, workspaceObject);
  }

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    return readCheckoutFile(await this.checkouts.clone(repository, "read"), path);
  }

  async list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    return entriesFromFiles(await this.listFiles(repository), path);
  }

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    return statFromFiles(path, await this.listFiles(repository), (filePath) =>
      this.readFile(repository, filePath),
    );
  }

  async writeFile(
    repository: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void> {
    await this.writeFiles(repository, [{ path, contents }]);
  }

  async writeFiles(
    repository: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void> {
    if (files.length === 0) return;

    const checkout = await this.checkouts.clone(repository, "write");
    await writeCheckoutFiles(checkout, files);
    await commitAndPush(checkout, updateMessage(files));
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    const checkout = await this.checkouts.clone(repository, "write");
    await deleteCheckoutFile(checkout, path);
    await commitAndPush(checkout, `Delete ${relativeGitPath(path)}`);
  }

  async currentRevision(repository: string): Promise<string | undefined> {
    if (!(await this.checkouts.repositoryHasCommits(repository))) return undefined;
    const checkout = await this.checkouts.clone(repository, "read");
    return git.resolveRef({ fs: checkout.fs, dir: checkout.dir, ref: "HEAD" });
  }

  async createWorkingCopy(
    baseRepository: string,
    copyId: string,
  ): Promise<string | undefined> {
    if (!(await this.checkouts.repositoryHasCommits(baseRepository))) return undefined;

    const checkout = await this.checkouts.clone(baseRepository, "write");
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
    return git.resolveRef({ fs: checkout.fs, dir: checkout.dir, ref: "HEAD" });
  }

  async readWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<Uint8Array | null> {
    return readCheckoutFile(
      await this.checkouts.cloneWorkingCopy(baseRepository, copyId, "read"),
      path,
    );
  }

  async listWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceEntry[]> {
    const files = await this.listWorkingCopyFiles(baseRepository, copyId);
    return entriesFromFiles(files, path);
  }

  async statWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceStat | null> {
    return statFromFiles(
      path,
      await this.listWorkingCopyFiles(baseRepository, copyId),
      (filePath) => this.readWorkingCopyFile(baseRepository, copyId, filePath),
    );
  }

  async writeWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void> {
    await this.writeWorkingCopyFiles(baseRepository, copyId, [{ path, contents }]);
  }

  async writeWorkingCopyFiles(
    baseRepository: string,
    copyId: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void> {
    if (files.length === 0) return;

    const checkout = await this.checkouts.cloneWorkingCopy(
      baseRepository,
      copyId,
      "write",
    );
    await writeCheckoutFiles(checkout, files);
    await commitAndPush(checkout, updateMessage(files));
  }

  async deleteWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<void> {
    const checkout = await this.checkouts.cloneWorkingCopy(
      baseRepository,
      copyId,
      "write",
    );
    await deleteCheckoutFile(checkout, path);
    await commitAndPush(checkout, `Delete ${relativeGitPath(path)}`);
  }

  async applyWorkingCopy(
    baseRepository: string,
    copyId: string,
  ): Promise<WorkspaceRevision> {
    const checkout = await this.checkouts.cloneWorkingCopy(
      baseRepository,
      copyId,
      "write",
    );
    const base = await this.checkouts.repoAccess(baseRepository, "write");
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

  async discardWorkingCopy(
    baseRepository: string,
    copyId: string,
  ): Promise<void> {
    const checkout = await this.checkouts.cloneForRemote(baseRepository, "write");
    const remoteRef = workingCopyRef(copyId);
    try {
      await git.push({
        fs: checkout.fs,
        http,
        dir: checkout.dir,
        url: checkout.access.remote,
        ref: checkout.branch,
        remoteRef,
        delete: true,
        onAuth: () => auth(checkout.access),
      });
    } catch (error) {
      if (isDeleteMissingRefError(error)) {
        throw new ArtifactsWorkingCopyRefNotFoundError(remoteRef, { cause: error });
      }
      throw error;
    }
  }

  private async listFiles(repository: string): Promise<string[]> {
    const checkout = await this.checkouts.clone(repository, "read");
    return git.listFiles({ fs: checkout.fs, dir: checkout.dir });
  }

  private async listWorkingCopyFiles(
    baseRepository: string,
    copyId: string,
  ): Promise<string[]> {
    const checkout = await this.checkouts.cloneWorkingCopy(
      baseRepository,
      copyId,
      "read",
    );
    return git.listFiles({ fs: checkout.fs, dir: checkout.dir });
  }
}

async function readCheckoutFile(
  checkout: Checkout,
  path: string,
): Promise<Uint8Array | null> {
  const rel = relativeGitPath(path);
  if (!rel) return null;
  try {
    const contents = await checkout.fs.promises.readFile(`${checkout.dir}/${rel}`);
    return contents instanceof Uint8Array
      ? new Uint8Array(contents)
      : textEncoder.encode(String(contents));
  } catch {
    return null;
  }
}

async function writeCheckoutFiles(
  checkout: Checkout,
  files: ArtifactsWorkspaceFileWrite[],
): Promise<void> {
  for (const file of files) {
    const rel = relativeGitPath(file.path);
    await mkdirp(checkout.fs, dirname(`${checkout.dir}/${rel}`));
    await checkout.fs.promises.writeFile(`${checkout.dir}/${rel}`, file.contents);
    await git.add({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
  }
}

async function deleteCheckoutFile(checkout: Checkout, path: string): Promise<void> {
  const rel = relativeGitPath(path);
  await checkout.fs.promises.unlink(`${checkout.dir}/${rel}`);
  await git.remove({ fs: checkout.fs, dir: checkout.dir, filepath: rel });
}

async function commitAndPush(checkout: Checkout, message: string): Promise<void> {
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

function updateMessage(files: ArtifactsWorkspaceFileWrite[]): string {
  const [first] = files;
  return `Update ${first ? relativeGitPath(first.path) : `${files.length} files`}`;
}

function isDeleteMissingRefError(error: unknown): boolean {
  return error instanceof Error &&
    /could not find|not found|does not exist|unable to delete/i.test(error.message);
}

async function mkdirp(fs: Fs, path: string): Promise<void> {
  if (path === "/") return;
  await fs.promises.mkdir(path, { recursive: true });
}
