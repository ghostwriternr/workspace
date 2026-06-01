import { Result } from "better-result";
import { Workspace, type WorkspaceFileCopy, type WorkspaceNamespace } from "@cloudflare/workspace";

import type { DemoDynamicWorkerRunner, DynamicWorkerResult } from "../workspace/dynamic-worker-runner";

export type RepoEditControllerDependencies = {
  workspaceName: string;
  workspaces: WorkspaceNamespace;
  dynamicWorkerRunner: Pick<DemoDynamicWorkerRunner, "runDynamicWorker">;
  getEditCopyId(): string | undefined;
  setEditCopyId(editCopyId: string | undefined): void;
};

export class RepoEditController {
  constructor(private readonly dependencies: RepoEditControllerDependencies) {}

  async runDynamicWorker({ code }: { code: string }): Promise<{
    status: "dynamic-worker-completed";
    editCopyId: string;
    result: DynamicWorkerResult;
  }> {
    const copy = await this.editCopy();
    const result = await this.dependencies.dynamicWorkerRunner.runDynamicWorker({
      editCopyId: copy.id,
      code,
    });

    return {
      status: "dynamic-worker-completed",
      editCopyId: copy.id,
      result,
    };
  }

  private async editCopy(): Promise<WorkspaceFileCopy> {
    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const existing = this.dependencies.getEditCopyId();
    if (existing) {
      const copy = await workspace.files.getCopy(existing);
      if (!Result.isError(copy)) {
        return copy.value;
      }
      this.dependencies.setEditCopyId(undefined);
    }

    const copy = await workspace.files.copy("coding-edit");
    if (Result.isError(copy)) {
      throw new Error(`start edit copy failed: ${copy.error.tag}`);
    }
    this.dependencies.setEditCopyId(copy.value.id);
    return copy.value;
  }
}
