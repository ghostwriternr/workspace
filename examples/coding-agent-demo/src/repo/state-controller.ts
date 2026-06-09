import { Result, type Result as BetterResult } from "better-result";
import { type Workspace, type WorkspaceEntry } from "@cloudflare/workspace";

type WorkspaceOperationError = { tag: string; message?: string };

type RepoReadableFiles = {
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceOperationError>>;
};

type RepoFileState = {
  path: string;
  type: "directory" | "file";
};

export type RepoState = {
  workspaceName: string;
  workingCopyId?: string;
  files: RepoFileState[];
};

export type RepoStateError = WorkspaceOperationError;

export type RepoStateControllerDependencies = {
  workspace: Workspace;
  workspaceName: string;
  workingCopyId?: string;
};

export class RepoStateController {
  constructor(private readonly dependencies: RepoStateControllerDependencies) {}

  async listRepoState(): Promise<BetterResult<RepoState, RepoStateError>> {
    const source = await this.filesToList(this.dependencies.workspace);
    if (Result.isError(source)) {
      return Result.err(source.error);
    }

    const files = await listTree(source.value, "/");
    if (Result.isError(files)) {
      return Result.err(files.error);
    }

    return Result.ok({
      workspaceName: this.dependencies.workspaceName,
      workingCopyId: this.dependencies.workingCopyId,
      files: files.value,
    });
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

async function listTree(files: RepoReadableFiles, root: string): Promise<BetterResult<RepoFileState[], RepoStateError>> {
  const result: RepoFileState[] = [];
  const listed = await visitTree(files, root, result);
  if (Result.isError(listed)) {
    return Result.err(listed.error);
  }

  return Result.ok(result.sort((left, right) => comparePath(left.path, right.path)));
}

async function visitTree(
  files: RepoReadableFiles,
  path: string,
  result: RepoFileState[],
): Promise<BetterResult<void, RepoStateError>> {
  const entries = await files.list(path);
  if (Result.isError(entries)) {
    if (entries.error.tag === "PathNotFoundError" && path === "/") {
      return Result.ok(undefined);
    }
    return Result.err(entries.error);
  }

  for (const entry of entries.value) {
    result.push({ path: entry.path, type: entry.type });

    if (entry.type === "directory") {
      const child = await visitTree(files, entry.path, result);
      if (Result.isError(child)) {
        return Result.err(child.error);
      }
    }
  }

  return Result.ok(undefined);
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
