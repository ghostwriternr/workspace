import { Result } from "better-result";
import { Workspace, type WorkspaceCurrentFilesApi, type WorkspaceNamespace } from "@cloudflare/workspace";

type RepoFileState = {
  path: string;
  type: "directory" | "file";
  size: number | null;
};

export type RepoState = {
  workspaceName: string;
  files: RepoFileState[];
};

export type RepoStateControllerDependencies = {
  workspaces: WorkspaceNamespace;
  workspaceName: string;
};

export class RepoStateController {
  constructor(private readonly dependencies: RepoStateControllerDependencies) {}

  async listRepoState(): Promise<RepoState> {
    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const files = await listTree(workspace.files, "/");

    return {
      workspaceName: this.dependencies.workspaceName,
      files,
    };
  }
}

async function listTree(files: Pick<WorkspaceCurrentFilesApi, "list" | "stat">, root: string): Promise<RepoFileState[]> {
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

  return result.sort((left, right) => left.path.localeCompare(right.path));
}
