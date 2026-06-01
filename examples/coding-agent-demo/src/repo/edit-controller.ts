import { Result, type Result as BetterResult } from "better-result";
import {
  Workspace,
  type WorkspaceApplyError,
  type WorkspaceCopyError,
  type WorkspaceCopyFileError,
  type WorkspaceCurrentFileError,
  type WorkspaceDiscardError,
  type WorkspaceEntry,
  type WorkspaceFileCopy,
  type WorkspaceFileWriteTreeError,
  type WorkspaceNamespace,
  type WorkspaceStat,
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

type RepoReadableFiles = {
  read(path: string): Promise<BetterResult<Uint8Array, WorkspaceCurrentFileError | WorkspaceCopyFileError>>;
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceCurrentFileError | WorkspaceCopyFileError>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceCurrentFileError | WorkspaceCopyFileError>>;
};

export type RepoReadResult =
  | { status: "file-read"; path: string; contents: string }
  | { status: "directory-listed"; path: string; entries: WorkspaceEntry[] };

export type RepoWriteResult = {
  status: "file-written";
  editCopyId: string;
  path: string;
};

export type RepoExactEditResult = {
  status: "file-edited";
  editCopyId: string;
  path: string;
  replacements: 1;
};

export type RepoRunResult = {
  status: "run-completed";
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

type TextNotFoundError = {
  tag: "TextNotFoundError";
  message: string;
  path: string;
};

type AmbiguousTextEditError = {
  tag: "AmbiguousTextEditError";
  message: string;
  path: string;
  matches: number;
};

export type NoActiveRepoEditError = {
  tag: "NoActiveRepoEditError";
  message: string;
};

export type RepoReadError = WorkspaceCurrentFileError | WorkspaceCopyError | WorkspaceCopyFileError;
export type RepoWriteError = WorkspaceCopyError | WorkspaceFileWriteTreeError;
export type RepoExactEditError = TextNotFoundError | AmbiguousTextEditError | WorkspaceCopyError | WorkspaceCopyFileError | WorkspaceFileWriteTreeError;
export type RepoRunError = WorkspaceCopyError | WorkspaceDynamicWorkerExecutionError;
export type RepoApplyEditError = NoActiveRepoEditError | WorkspaceCopyError | WorkspaceApplyError;
export type RepoDiscardEditError = NoActiveRepoEditError | WorkspaceCopyError | WorkspaceDiscardError;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class RepoEditController {
  constructor(private readonly dependencies: RepoEditControllerDependencies) {}

  async read({ path }: { path: string }): Promise<BetterResult<RepoReadResult, RepoReadError>> {
    const files = await this.filesForRead();
    if (Result.isError(files)) {
      return Result.err(files.error);
    }

    const stat = await files.value.stat(path);
    if (Result.isError(stat)) {
      return Result.err(stat.error);
    }

    if (stat.value.type === "directory") {
      const entries = await files.value.list(path);
      if (Result.isError(entries)) {
        return Result.err(entries.error);
      }
      return Result.ok({ status: "directory-listed", path, entries: entries.value });
    }

    const contents = await files.value.read(path);
    if (Result.isError(contents)) {
      return Result.err(contents.error);
    }
    return Result.ok({ status: "file-read", path, contents: decoder.decode(contents.value) });
  }

  async write({ path, contents }: { path: string; contents: string }): Promise<BetterResult<RepoWriteResult, RepoWriteError>> {
    const copy = await this.editCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const written = await copy.value.files.writeTree("/", [
      { path: relativeTreePath(path), contents: encoder.encode(contents) },
    ]);
    if (Result.isError(written)) {
      return Result.err(written.error);
    }

    return Result.ok({ status: "file-written", editCopyId: copy.value.id, path });
  }

  async edit({ path, oldText, newText }: { path: string; oldText: string; newText: string }): Promise<BetterResult<RepoExactEditResult, RepoExactEditError>> {
    const copy = await this.editCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const current = await copy.value.files.read(path);
    if (Result.isError(current)) {
      return Result.err(current.error);
    }

    const text = decoder.decode(current.value);
    const matches = countMatches(text, oldText);
    if (matches === 0) {
      return Result.err({
        tag: "TextNotFoundError",
        message: `Text not found in ${path}.`,
        path,
      });
    }
    if (matches > 1) {
      return Result.err({
        tag: "AmbiguousTextEditError",
        message: `Text appears ${matches} times in ${path}.`,
        path,
        matches,
      });
    }

    const written = await copy.value.files.writeTree("/", [
      { path: relativeTreePath(path), contents: encoder.encode(text.split(oldText).join(newText)) },
    ]);
    if (Result.isError(written)) {
      return Result.err(written.error);
    }

    return Result.ok({ status: "file-edited", editCopyId: copy.value.id, path, replacements: 1 });
  }

  async run({ code }: { code: string }): Promise<BetterResult<RepoRunResult, RepoRunError>> {
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
      status: "run-completed",
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

  private async filesForRead(): Promise<BetterResult<RepoReadableFiles, WorkspaceCopyError>> {
    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const editCopyId = this.dependencies.getEditCopyId();
    if (!editCopyId) {
      return Result.ok(workspace.files);
    }

    const copy = await workspace.files.getCopy(editCopyId);
    if (Result.isError(copy)) {
      this.dependencies.setEditCopyId(undefined);
      return Result.err(copy.error);
    }
    return Result.ok(copy.value.files);
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

function relativeTreePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function countMatches(text: string, needle: string): number {
  return needle.length === 0 ? 0 : text.split(needle).length - 1;
}
