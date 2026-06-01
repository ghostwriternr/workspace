import { Result, type Result as BetterResult } from "better-result";
import {
  Workspace,
  type WorkspaceCopyError,
  type WorkspaceFileCopy,
  type WorkspaceNamespace,
} from "@cloudflare/workspace";

import type { DemoDynamicWorkerRunner, DynamicWorkerResult } from "../workspace/dynamic-worker-runner";

export type RepoEditControllerDependencies = {
  workspaceName: string;
  workspaces: WorkspaceNamespace;
  dynamicWorkerRunner: Pick<DemoDynamicWorkerRunner, "runDynamicWorker">;
  getEditCopyId(): string | undefined;
  setEditCopyId(editCopyId: string | undefined): void;
};

export type RepoEditResult = {
  status: "dynamic-worker-completed";
  editCopyId: string;
  result: DynamicWorkerResult;
};

type DynamicWorkerExecutionError = {
  tag: "DynamicWorkerExecutionError";
  message: string;
};

export type RepoEditError = WorkspaceCopyError | DynamicWorkerExecutionError;

export class RepoEditController {
  constructor(private readonly dependencies: RepoEditControllerDependencies) {}

  async runDynamicWorker({ code }: { code: string }): Promise<BetterResult<RepoEditResult, RepoEditError>> {
    const copy = await this.editCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    try {
      const result = await this.dependencies.dynamicWorkerRunner.runDynamicWorker({
        editCopyId: copy.value.id,
        code,
      });

      return Result.ok({
        status: "dynamic-worker-completed",
        editCopyId: copy.value.id,
        result,
      });
    } catch (error) {
      return Result.err(dynamicWorkerExecutionError(error));
    }
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

function dynamicWorkerExecutionError(error: unknown): DynamicWorkerExecutionError {
  return {
    tag: "DynamicWorkerExecutionError",
    message: error instanceof Error ? error.message : "Dynamic Worker execution failed.",
  };
}
