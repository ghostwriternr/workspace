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
import { normalizeAgentPath } from "../agent/path";

export type RepoWorkingCopyControllerDependencies = {
  workspaceName: string;
  workspaces: WorkspaceNamespace;
  dynamicWorkerRunner: WorkspaceDynamicWorkerRunner;
  workspaceForWorkingCopy(workingCopyId: string): WorkspaceDynamicWorkerFileCapability;
  getWorkingCopyId(): string | undefined;
  setWorkingCopyId(workingCopyId: string | undefined): void;
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
  path: string;
};

export type RepoExactEditResult = {
  status: "file-edited";
  path: string;
  replacements: 1;
};

export type RepoRunResult = {
  status: "run-completed";
  result: WorkspaceDynamicWorkerResult;
};

export type RepoApplyWorkingCopyResult = {
  status: "working-copy-applied";
  workingCopyId: string;
  revisionId: string;
  createdAt: number;
};

export type RepoDiscardWorkingCopyResult = {
  status: "working-copy-discarded";
  workingCopyId: string;
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

export type NoActiveWorkingCopyError = {
  tag: "NoActiveWorkingCopyError";
  message: string;
};

export type RepoReadError = WorkspaceCurrentFileError | WorkspaceCopyError | WorkspaceCopyFileError;
export type RepoWriteError = WorkspaceCopyError | WorkspaceFileWriteTreeError;
export type RepoExactEditError = TextNotFoundError | AmbiguousTextEditError | WorkspaceCopyError | WorkspaceCopyFileError | WorkspaceFileWriteTreeError;
export type RepoRunError = WorkspaceCopyError | WorkspaceDynamicWorkerExecutionError;
export type RepoApplyWorkingCopyError = NoActiveWorkingCopyError | WorkspaceCopyError | WorkspaceApplyError;
export type RepoDiscardWorkingCopyError = NoActiveWorkingCopyError | WorkspaceCopyError | WorkspaceDiscardError;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class RepoWorkingCopyController {
  constructor(private readonly dependencies: RepoWorkingCopyControllerDependencies) {}

  async read({ path }: { path: string }): Promise<BetterResult<RepoReadResult, RepoReadError>> {
    const normalizedPath = normalizeAgentPath(path);
    const files = await this.filesForRead();
    if (Result.isError(files)) {
      return Result.err(files.error);
    }

    const stat = await files.value.stat(normalizedPath);
    if (Result.isError(stat)) {
      return Result.err(stat.error);
    }

    if (stat.value.type === "directory") {
      const entries = await files.value.list(normalizedPath);
      if (Result.isError(entries)) {
        return Result.err(entries.error);
      }
      return Result.ok({ status: "directory-listed", path: normalizedPath, entries: entries.value });
    }

    const contents = await files.value.read(normalizedPath);
    if (Result.isError(contents)) {
      return Result.err(contents.error);
    }
    return Result.ok({ status: "file-read", path: normalizedPath, contents: decoder.decode(contents.value) });
  }

  async write({ path, contents }: { path: string; contents: string }): Promise<BetterResult<RepoWriteResult, RepoWriteError>> {
    const normalizedPath = normalizeAgentPath(path);
    const copy = await this.workingCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const written = await copy.value.files.writeTree("/", [
      { path: relativeTreePath(normalizedPath), contents: encoder.encode(contents) },
    ]);
    if (Result.isError(written)) {
      return Result.err(written.error);
    }

    return Result.ok({ status: "file-written", path: normalizedPath });
  }

  async edit({ path, oldText, newText }: { path: string; oldText: string; newText: string }): Promise<BetterResult<RepoExactEditResult, RepoExactEditError>> {
    const normalizedPath = normalizeAgentPath(path);
    const copy = await this.workingCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const current = await copy.value.files.read(normalizedPath);
    if (Result.isError(current)) {
      return Result.err(current.error);
    }

    const text = decoder.decode(current.value);
    const matches = countMatches(text, oldText);
    if (matches === 0) {
      return Result.err({
        tag: "TextNotFoundError",
        message: `Text not found in ${normalizedPath}.`,
        path: normalizedPath,
      });
    }
    if (matches > 1) {
      return Result.err({
        tag: "AmbiguousTextEditError",
        message: `Text appears ${matches} times in ${normalizedPath}.`,
        path: normalizedPath,
        matches,
      });
    }

    const written = await copy.value.files.writeTree("/", [
      { path: relativeTreePath(normalizedPath), contents: encoder.encode(text.split(oldText).join(newText)) },
    ]);
    if (Result.isError(written)) {
      return Result.err(written.error);
    }

    return Result.ok({ status: "file-edited", path: normalizedPath, replacements: 1 });
  }

  async run({ code }: { code: string }): Promise<BetterResult<RepoRunResult, RepoRunError>> {
    const copy = await this.workingCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const result = await this.dependencies.dynamicWorkerRunner.run({
      code,
      workspace: this.dependencies.workspaceForWorkingCopy(copy.value.id),
    });
    if (Result.isError(result)) {
      return Result.err(result.error);
    }

    return Result.ok({
      status: "run-completed",
      result: result.value,
    });
  }

  async applyWorkingCopy(): Promise<BetterResult<RepoApplyWorkingCopyResult, RepoApplyWorkingCopyError>> {
    const copy = await this.activeWorkingCopy("apply");
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const applied = await copy.value.apply();
    if (Result.isError(applied)) {
      return Result.err(applied.error);
    }

    this.dependencies.setWorkingCopyId(undefined);
    return Result.ok({
      status: "working-copy-applied",
      workingCopyId: copy.value.id,
      revisionId: applied.value.revisionId,
      createdAt: applied.value.createdAt,
    });
  }

  async discardWorkingCopy(): Promise<BetterResult<RepoDiscardWorkingCopyResult, RepoDiscardWorkingCopyError>> {
    const copy = await this.activeWorkingCopy("discard");
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const discarded = await copy.value.discard();
    if (Result.isError(discarded)) {
      return Result.err(discarded.error);
    }

    this.dependencies.setWorkingCopyId(undefined);
    return Result.ok({
      status: "working-copy-discarded",
      workingCopyId: copy.value.id,
    });
  }

  private async filesForRead(): Promise<BetterResult<RepoReadableFiles, WorkspaceCopyError>> {
    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const workingCopyId = this.dependencies.getWorkingCopyId();
    if (!workingCopyId) {
      return Result.ok(workspace.files);
    }

    const copy = await workspace.files.getCopy(workingCopyId);
    if (Result.isError(copy)) {
      this.dependencies.setWorkingCopyId(undefined);
      return Result.err(copy.error);
    }
    return Result.ok(copy.value.files);
  }

  private async workingCopy(): Promise<BetterResult<WorkspaceFileCopy, WorkspaceCopyError>> {
    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const existing = this.dependencies.getWorkingCopyId();
    if (existing) {
      const copy = await workspace.files.getCopy(existing);
      if (!Result.isError(copy)) {
        return Result.ok(copy.value);
      }
      this.dependencies.setWorkingCopyId(undefined);
    }

    const copy = await workspace.files.copy("coding-working-copy");
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }
    this.dependencies.setWorkingCopyId(copy.value.id);
    return Result.ok(copy.value);
  }

  private async activeWorkingCopy(action: "apply" | "discard"): Promise<BetterResult<WorkspaceFileCopy, NoActiveWorkingCopyError | WorkspaceCopyError>> {
    const workingCopyId = this.dependencies.getWorkingCopyId();
    if (!workingCopyId) {
      return Result.err({
        tag: "NoActiveWorkingCopyError",
        message: `There is no active working copy to ${action}.`,
      });
    }

    const workspace = Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
    const copy = await workspace.files.getCopy(workingCopyId);
    if (Result.isError(copy)) {
      this.dependencies.setWorkingCopyId(undefined);
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
