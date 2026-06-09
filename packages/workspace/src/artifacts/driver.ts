import type { WorkspaceEntry, WorkspaceRevision, WorkspaceStat } from "../model/entries";
import type { WorkspaceObjectClient } from "../workspace-object";
import type { ArtifactsBindingClient } from "./binding";
import type { ArtifactsWorkspaceFileWrite } from "./file-target";

export type ArtifactsWorkspaceDriver = {
  readFile(repository: string, path: string): Promise<Uint8Array | null>;
  list(repository: string, path: string): Promise<WorkspaceEntry[]>;
  stat(repository: string, path: string): Promise<WorkspaceStat | null>;
  writeFile(
    repository: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void>;
  writeFiles(
    repository: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void>;
  deleteFile(repository: string, path: string): Promise<void>;
  currentRevision(repository: string): Promise<string | undefined>;
  createWorkingCopy(
    baseRepository: string,
    copyId: string,
  ): Promise<string | undefined>;
  readWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<Uint8Array | null>;
  listWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceEntry[]>;
  statWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceStat | null>;
  writeWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void>;
  writeWorkingCopyFiles(
    baseRepository: string,
    copyId: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void>;
  deleteWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<void>;
  applyWorkingCopy(
    baseRepository: string,
    copyId: string,
  ): Promise<WorkspaceRevision>;
  discardWorkingCopy(baseRepository: string, copyId: string): Promise<void>;
};

export type ArtifactsWorkspaceDriverFactory = (
  artifacts: ArtifactsBindingClient,
  workspaceObject: WorkspaceObjectClient,
) => ArtifactsWorkspaceDriver;

export function createLazyIsomorphicGitArtifactsWorkspaceDriver(
  artifacts: ArtifactsBindingClient,
  workspaceObject: WorkspaceObjectClient,
): ArtifactsWorkspaceDriver {
  return new LazyIsomorphicGitArtifactsWorkspaceDriver(artifacts, workspaceObject);
}

class LazyIsomorphicGitArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  private driver?: Promise<ArtifactsWorkspaceDriver>;

  constructor(
    private readonly artifacts: ArtifactsBindingClient,
    private readonly workspaceObject: WorkspaceObjectClient,
  ) {}

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    return (await this.load()).readFile(repository, path);
  }

  async list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    return (await this.load()).list(repository, path);
  }

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    return (await this.load()).stat(repository, path);
  }

  async writeFile(
    repository: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void> {
    return (await this.load()).writeFile(repository, path, contents);
  }

  async writeFiles(
    repository: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void> {
    return (await this.load()).writeFiles(repository, files);
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    return (await this.load()).deleteFile(repository, path);
  }

  async currentRevision(repository: string): Promise<string | undefined> {
    return (await this.load()).currentRevision(repository);
  }

  async createWorkingCopy(
    baseRepository: string,
    copyId: string,
  ): Promise<string | undefined> {
    return (await this.load()).createWorkingCopy(baseRepository, copyId);
  }

  async readWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<Uint8Array | null> {
    return (await this.load()).readWorkingCopyFile(baseRepository, copyId, path);
  }

  async listWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceEntry[]> {
    return (await this.load()).listWorkingCopy(baseRepository, copyId, path);
  }

  async statWorkingCopy(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<WorkspaceStat | null> {
    return (await this.load()).statWorkingCopy(baseRepository, copyId, path);
  }

  async writeWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
    contents: Uint8Array,
  ): Promise<void> {
    return (await this.load()).writeWorkingCopyFile(
      baseRepository,
      copyId,
      path,
      contents,
    );
  }

  async writeWorkingCopyFiles(
    baseRepository: string,
    copyId: string,
    files: ArtifactsWorkspaceFileWrite[],
  ): Promise<void> {
    return (await this.load()).writeWorkingCopyFiles(baseRepository, copyId, files);
  }

  async deleteWorkingCopyFile(
    baseRepository: string,
    copyId: string,
    path: string,
  ): Promise<void> {
    return (await this.load()).deleteWorkingCopyFile(baseRepository, copyId, path);
  }

  async applyWorkingCopy(
    baseRepository: string,
    copyId: string,
  ): Promise<WorkspaceRevision> {
    return (await this.load()).applyWorkingCopy(baseRepository, copyId);
  }

  async discardWorkingCopy(baseRepository: string, copyId: string): Promise<void> {
    return (await this.load()).discardWorkingCopy(baseRepository, copyId);
  }

  private load(): Promise<ArtifactsWorkspaceDriver> {
    this.driver ??= import("./git-driver").then((module) =>
      module.createIsomorphicGitArtifactsWorkspaceDriver(
        this.artifacts,
        this.workspaceObject,
      ),
    );
    return this.driver;
  }
}
