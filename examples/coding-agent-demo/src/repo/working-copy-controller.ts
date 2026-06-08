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
  type WorkspaceStat,
} from "@cloudflare/workspace";
import type {
  WorkspaceDynamicWorkerExecutionError,
  WorkspaceDynamicWorkerFileCapability,
  WorkspaceDynamicWorkerResult,
  WorkspaceDynamicWorkerRunner,
} from "@cloudflare/workspace-adapter-dynamic-worker";
import type {
  WorkspaceSandboxCommandError,
  WorkspaceSandboxCommandRunner,
  WorkspaceSandboxCommandResult,
} from "@cloudflare/workspace-adapter-sandbox";
import { normalizeAgentPath } from "../agent/path";

export type RepoWorkingCopyControllerDependencies = {
  workspaceName: string;
  workspace: Workspace;
  dynamicWorkerRunner: WorkspaceDynamicWorkerRunner;
  shellRunner: WorkspaceSandboxCommandRunner;
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
  | {
      status: "file-read";
      path: string;
      contents: string;
      startLine: number;
      endLine: number;
      totalLines: number;
      truncated: boolean;
    }
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

export type RepoShellResult = WorkspaceSandboxCommandResult & {
  status: "shell-completed";
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

type ReadOffsetOutOfRangeError = {
  tag: "ReadOffsetOutOfRangeError";
  message: string;
  path: string;
  offset: number;
  totalLines: number;
};

export type RepoReadError = ReadOffsetOutOfRangeError | WorkspaceCurrentFileError | WorkspaceCopyError | WorkspaceCopyFileError;
export type RepoWriteError = WorkspaceCopyError | WorkspaceFileWriteTreeError;
export type RepoExactEditError = TextNotFoundError | AmbiguousTextEditError | WorkspaceCopyError | WorkspaceCopyFileError | WorkspaceFileWriteTreeError;
export type RepoRunError = WorkspaceCopyError | WorkspaceDynamicWorkerExecutionError;
export type RepoShellError = WorkspaceCopyError | WorkspaceSandboxCommandError;
export type RepoApplyWorkingCopyError = NoActiveWorkingCopyError | WorkspaceCopyError | WorkspaceApplyError;
export type RepoDiscardWorkingCopyError = NoActiveWorkingCopyError | WorkspaceCopyError | WorkspaceDiscardError;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_READ_MAX_LINES = 2000;
const DEFAULT_READ_MAX_BYTES = 50 * 1024;

export class RepoWorkingCopyController {
  constructor(private readonly dependencies: RepoWorkingCopyControllerDependencies) {}

  async read({ path, offset, limit }: { path: string; offset?: number; limit?: number }): Promise<BetterResult<RepoReadResult, RepoReadError>> {
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
    return formatReadResult(normalizedPath, decoder.decode(contents.value), { offset, limit });
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

  async shell({ command }: { command: string }): Promise<BetterResult<RepoShellResult, RepoShellError>> {
    const copy = await this.workingCopy();
    if (Result.isError(copy)) {
      return Result.err(copy.error);
    }

    const result = await this.dependencies.shellRunner.runCommand({
      files: copy.value.files,
      sandboxId: copy.value.id,
      command,
      root: "/workspace",
    });
    if (Result.isError(result)) {
      return Result.err(result.error);
    }

    return Result.ok({
      status: "shell-completed",
      ...result.value,
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
    const workspace = this.dependencies.workspace;
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
    const workspace = this.dependencies.workspace;
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

    const workspace = this.dependencies.workspace;
    const copy = await workspace.files.getCopy(workingCopyId);
    if (Result.isError(copy)) {
      this.dependencies.setWorkingCopyId(undefined);
      return Result.err(copy.error);
    }

    return Result.ok(copy.value);
  }
}

function formatReadResult(
  path: string,
  text: string,
  options: { offset?: number; limit?: number },
): BetterResult<RepoReadResult, ReadOffsetOutOfRangeError> {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const startLine = options.offset ?? 1;
  const startIndex = Math.max(0, startLine - 1);
  if (startIndex >= totalLines) {
    return Result.err({
      tag: "ReadOffsetOutOfRangeError",
      message: `Offset ${startLine} is beyond end of ${path} (${formatLineCount(totalLines)} total).`,
      path,
      offset: startLine,
      totalLines,
    });
  }

  const requestedEndIndex = options.limit === undefined
    ? totalLines
    : Math.min(totalLines, startIndex + options.limit);
  const maxLines = Math.min(options.limit ?? DEFAULT_READ_MAX_LINES, DEFAULT_READ_MAX_LINES);
  const selected = selectReadableLines(lines, startIndex, requestedEndIndex, maxLines);
  const endLine = selected.outputLines === 0 ? startLine - 1 : startLine + selected.outputLines - 1;
  const note = readContinuationNote({
    endLine,
    limitedBy: selected.limitedBy,
    startLine,
    totalLines,
  });
  const contents = note
    ? selected.contents.length > 0 ? `${selected.contents}\n\n${note}` : note
    : selected.contents;

  return Result.ok({
    status: "file-read",
    path,
    contents,
    startLine,
    endLine,
    totalLines,
    truncated: note !== undefined,
  });
}

type SelectedLines = {
  contents: string;
  outputLines: number;
  limitedBy?: "lines" | "bytes" | "user";
};

function selectReadableLines(
  lines: string[],
  startIndex: number,
  requestedEndIndex: number,
  maxLines: number,
): SelectedLines {
  const output: string[] = [];
  let limitedBy: SelectedLines["limitedBy"];

  for (let index = startIndex; index < requestedEndIndex && output.length < maxLines; index += 1) {
    const next = [...output, lines[index] ?? ""];
    const bytes = encoder.encode(next.join("\n")).byteLength;
    if (bytes > DEFAULT_READ_MAX_BYTES) {
      limitedBy = "bytes";
      break;
    }
    output.push(lines[index] ?? "");
  }

  const consumedAllRequested = startIndex + output.length >= requestedEndIndex;
  if (!limitedBy && !consumedAllRequested) {
    limitedBy = "lines";
  }
  if (!limitedBy && requestedEndIndex < lines.length) {
    limitedBy = "user";
  }

  return { contents: output.join("\n"), outputLines: output.length, limitedBy };
}

type ContinuationNoteOptions = {
  startLine: number;
  endLine: number;
  totalLines: number;
  limitedBy?: "lines" | "bytes" | "user";
};

function readContinuationNote(options: ContinuationNoteOptions): string | undefined {
  if (!options.limitedBy) return undefined;

  const nextOffset = options.endLine + 1;
  if (options.limitedBy === "user") {
    const remaining = options.totalLines - options.endLine;
    return `[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
  }

  if (options.limitedBy === "bytes") {
    if (options.endLine < options.startLine) {
      return `[Line ${options.startLine} exceeds the ${formatSize(DEFAULT_READ_MAX_BYTES)} read limit.]`;
    }
    return `[Showing lines ${options.startLine}-${options.endLine} of ${options.totalLines} (${formatSize(DEFAULT_READ_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
  }

  return `[Showing lines ${options.startLine}-${options.endLine} of ${options.totalLines}. Use offset=${nextOffset} to continue.]`;
}

function formatLineCount(lines: number): string {
  return `${lines} ${lines === 1 ? "line" : "lines"}`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes}B` : `${Math.round(bytes / 1024)}KB`;
}

function relativeTreePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function countMatches(text: string, needle: string): number {
  return needle.length === 0 ? 0 : text.split(needle).length - 1;
}
