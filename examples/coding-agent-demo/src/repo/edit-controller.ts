import { Result, type Result as BetterResult } from "better-result";
import {
  Workspace,
  type WorkspaceApplyError,
  type WorkspaceCopyError,
  type WorkspaceDiscardError,
  type WorkspaceFileCopy,
  type WorkspaceNamespace,
} from "@cloudflare/workspace";
import type {
  WorkspaceDynamicWorkerExecutionError,
  WorkspaceDynamicWorkerFileCapability,
  WorkspaceDynamicWorkerResult,
  WorkspaceDynamicWorkerRunner,
} from "@cloudflare/workspace-adapter-dynamic-worker";

export type RepoEditControllerDependencies = {
  workspaceName: string;
  workspaces: WorkspaceNamespace;
  dynamicWorkerRunner: WorkspaceDynamicWorkerRunner;
  workspaceForEdit(editCopyId: string): WorkspaceDynamicWorkerFileCapability;
  getEditCopyId(): string | undefined;
  setEditCopyId(editCopyId: string | undefined): void;
};

export type RepoWorkspaceWorkerResult = {
  status: "workspace-worker-completed";
  editCopyId: string;
  result: WorkspaceDynamicWorkerResult;
};

export type RepoApplyEditResult = {
  status: "edit-applied";
  editCopyId: string;
  revisionId: string;
  createdAt: number;
};

export type RepoDiscardEditResult = {
  status: "edit-discarded";
  editCopyId: string;
};

export type NoActiveRepoEditError = {
  tag: "NoActiveRepoEditError";
  message: string;
};

export type RepoEditError = WorkspaceCopyError | WorkspaceDynamicWorkerExecutionError;
export type RepoApplyEditError = NoActiveRepoEditError | WorkspaceCopyError | WorkspaceApplyError;
export type RepoDiscardEditError = NoActiveRepoEditError | WorkspaceCopyError | WorkspaceDiscardError;

export class RepoEditController {
  constructor(private readonly dependencies: RepoEditControllerDependencies) {}

  async runWorkspaceWorker({ code }: { code: string }): Promise<BetterResult<RepoWorkspaceWorkerResult, RepoEditError>> {
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
      status: "workspace-worker-completed",
      editCopyId: copy.value.id,
      result: result.value,
    });
  }

  async applyEdit(): Promise<BetterResult<RepoApplyEditResult, RepoApplyEditError>> {
    const copy = await this.activeEditCopy("apply");
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const applied = await copy.value.apply();
    if (Result.isError(applied)) {
      return Result.err(applied.error);
    }

    this.dependencies.setEditCopyId(undefined);
    return Result.ok({
      status: "edit-applied",
      editCopyId: copy.value.id,
      revisionId: applied.value.revisionId,
      createdAt: applied.value.createdAt,
    });
  }

  async discardEdit(): Promise<BetterResult<RepoDiscardEditResult, RepoDiscardEditError>> {
    const copy = await this.activeEditCopy("discard");
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const discarded = await copy.value.discard();
    if (Result.isError(discarded)) {
      return Result.err(discarded.error);
    }

    this.dependencies.setEditCopyId(undefined);
    return Result.ok({
      status: "edit-discarded",
      editCopyId: copy.value.id,
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

  private async activeEditCopy(action: "apply" | "discard"): Promise<BetterResult<WorkspaceFileCopy, NoActiveRepoEditError | WorkspaceCopyError>> {
    const editCopyId = this.dependencies.getEditCopyId();
    if (!editCopyId) {
      return Result.err({
        tag: "NoActiveRepoEditError",
        message: `There is no active repo edit to ${action}.`,
      });
    }

    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const copy = await workspace.files.getCopy(editCopyId);
    if (Result.isError(copy)) {
      this.dependencies.setEditCopyId(undefined);
      return Result.err(copy.error);
    }

    return Result.ok(copy.value);
  }
}
