import { Result, type Result as BetterResult } from "better-result";
import {
  Workspace,
  type ScopedWorkspaceFileCapability,
  type WorkspaceCopyError,
  type WorkspaceFileCopy,
  type WorkspaceNamespace,
} from "@cloudflare/workspace";
import type {
  WorkspaceDynamicWorkerExecutionError,
  WorkspaceDynamicWorkerResult,
  WorkspaceDynamicWorkerRunner,
} from "@cloudflare/workspace-adapter-dynamic-worker";

export type RepoEditControllerDependencies = {
  workspaceName: string;
  workspaces: WorkspaceNamespace;
  dynamicWorkerRunner: WorkspaceDynamicWorkerRunner;
  workspaceForEdit(editCopyId: string): ScopedWorkspaceFileCapability;
  getEditCopyId(): string | undefined;
  setEditCopyId(editCopyId: string | undefined): void;
};

export type RepoEditResult = {
  status: "dynamic-worker-completed";
  editCopyId: string;
  result: WorkspaceDynamicWorkerResult;
};

export type RepoEditError = WorkspaceCopyError | WorkspaceDynamicWorkerExecutionError;

export class RepoEditController {
  constructor(private readonly dependencies: RepoEditControllerDependencies) {}

  async runDynamicWorker({ code }: { code: string }): Promise<BetterResult<RepoEditResult, RepoEditError>> {
    const copy = await this.editCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const result = await this.dependencies.dynamicWorkerRunner.run({
      code,
      workspace: this.dependencies.workspaceForEdit(copy.value.id),
    });
    if (Result.isError(result)) {
      return Result.err(result.error);
    }

    return Result.ok({
      status: "dynamic-worker-completed",
      editCopyId: copy.value.id,
      result: result.value,
    });
  }

  private async editCopy(): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>> {
    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const existing = this.dependencies.getEditCopyId();
    if (existing) {
      const copy = await workspace.files.getCopy(existing);
      if (!Result.isError(copy)) {
        return Result.ok(copy.value);
      }
      this.dependencies.setEditCopyId(undefined);
    }

    const copy = await workspace.files.copy("coding-edit");
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }
    this.dependencies.setEditCopyId(copy.value.id);
    return Result.ok(copy.value);
  }
}
