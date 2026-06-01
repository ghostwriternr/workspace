import { Result, type Result as BetterResult } from "better-result";
import { Workspace, type WorkspaceNamespace } from "@cloudflare/workspace";

type WorkspaceOperationError = { tag: string };

type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

type WorkspaceStat = {
  path: string;
  type: "directory" | "file";
  size: number | null;
  createdAt: number;
  updatedAt: number;
};

type RepoReadableFiles = {
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceOperationError>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceOperationError>>;
};

type RepoFileState = {
  path: string;
  type: "directory" | "file";
  size: number | null;
};

export type RepoState = {
  workspaceName: string;
  editCopyId?: string;
  files: RepoFileState[];
};

export type RepoStateControllerDependencies = {
  workspaces: WorkspaceNamespace;
  workspaceName: string;
  editCopyId?: string;
};

export class RepoStateController {
  constructor(private readonly dependencies: RepoStateControllerDependencies) {}

  async listRepoState(): Promise<RepoState> {
    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const source = await this.filesToList(workspace);
    const files = await listTree(source, "/");

    return {
      workspaceName: this.dependencies.workspaceName,
      editCopyId: this.dependencies.editCopyId,
      files,
    };
  }

  private async filesToList(workspace: Workspace): Promise<RepoReadableFiles> {
    if (!this.dependencies.editCopyId) {
      return workspace.files;
    }

    const copy = await workspace.files.getCopy(this.dependencies.editCopyId);
    if (Result.isError(copy)) {
      throw new Error(`edit copy not found: ${copy.error.tag}`);
    }
    return copy.value.files;
  }
}

async function listTree(files: RepoReadableFiles, root: string): Promise<RepoFileState[]> {
  const entries = await files.list(root);
  if (Result.isError(entries)) {
    if (entries.error.tag === "PathNotFoundError") {
      return [];
    }
    throw new Error(`list repo state failed with ${entries.error.tag}`);
  }

  const result: RepoFileState[] = [];
  for (const entry of entries.value) {
    const stat = await files.stat(entry.path);
    if (Result.isError(stat)) {
      throw new Error(`stat ${entry.path} failed with ${stat.error.tag}`);
    }

    result.push({
      path: entry.path,
      type: entry.type,
      size: stat.value.size,
    });

    if (entry.type === "directory") {
      result.push(...await listTree(files, entry.path));
    }
  }

  return result.sort((left, right) => comparePath(left.path, right.path));
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
