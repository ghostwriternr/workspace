import { Result, type Result as BetterResult } from "better-result";
import { type Workspace, type WorkspaceEntry } from "@cloudflare/workspace";

type WorkspaceOperationError = { tag: string; message?: string };

type RepoReadableFiles = {
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceOperationError>>;
};

type RepoFileState = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export type RepoState = {
  workspaceName: string;
  workingCopyId?: string;
};

export type RepoDirectoryState = RepoState & {
  path: string;
  entries: RepoFileState[];
};

export type RepoStateError = WorkspaceOperationError;

export type RepoStateControllerDependencies = {
  workspace: Workspace;
  workspaceName: string;
  workingCopyId?: string;
};

export class RepoStateController {
  constructor(private readonly dependencies: RepoStateControllerDependencies) {}

  async getRepoState(): Promise<BetterResult<RepoState, RepoStateError>> {
    return Result.ok(this.repoState());
  }

  async listDirectory({ path = "/" }: { path?: string } = {}): Promise<BetterResult<RepoDirectoryState, RepoStateError>> {
    const source = await this.filesToList(this.dependencies.workspace);
    if (Result.isError(source)) {
      return Result.err(source.error);
    }

    const normalizedPath = normalizeDirectoryPath(path);
    const entries = await source.value.list(normalizedPath);
    if (Result.isError(entries)) {
      if (entries.error.tag === "PathNotFoundError" && normalizedPath === "/") {
        return Result.ok({ ...this.repoState(), path: normalizedPath, entries: [] });
      }
      return Result.err(entries.error);
    }

    return Result.ok({
      ...this.repoState(),
      path: normalizedPath,
      entries: entries.value.map(entryState).sort((left, right) => comparePath(left.path, right.path)),
    });
  }

  private repoState(): RepoState {
    return {
      workspaceName: this.dependencies.workspaceName,
      ...(this.dependencies.workingCopyId ? { workingCopyId: this.dependencies.workingCopyId } : {}),
    };
  }

  private async filesToList(workspace: Workspace): Promise<BetterResult<RepoReadableFiles, RepoStateError>> {
    if (!this.dependencies.workingCopyId) {
      return Result.ok(workspace.files);
    }

    const copy = await workspace.copies.get(this.dependencies.workingCopyId);
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }
    return Result.ok(copy.value.files);
  }
}

function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === ".") {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function entryState(entry: WorkspaceEntry): RepoFileState {
  return {
    name: entry.path === "/" ? "/" : entry.path.split("/").filter(Boolean).at(-1) ?? entry.path,
    path: entry.path,
    type: entry.type,
  };
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
