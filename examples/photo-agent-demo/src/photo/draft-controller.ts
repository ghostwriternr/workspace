import { Result, type Result as BetterResult } from "better-result";
import {
  Workspace,
  type WorkspaceFileCopy,
  type WorkspaceNamespace,
} from "@cloudflare/workspace";
import type { WorkspaceFileCaptureSummary } from "@cloudflare/workspace";
import type { DemoWorkspaceCommandRunner } from "../workspace/sandbox-workspace-command-runner";
import type {
  WorkspaceDynamicWorkerResult,
  WorkspaceDynamicWorkerRunner,
} from "@cloudflare/workspace-adapter-dynamic-worker";
import type { ScopedWorkspaceFileCapability } from "@cloudflare/workspace";

const ORIGINAL_CANDIDATES = [
  { path: "/photos/original.png", contentType: "image/png" },
  { path: "/photos/original.jpg", contentType: "image/jpeg" },
] as const;
const CURRENT_PATH = "/photos/current";
const WORKSPACE_ROOT = "/workspace";

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string } };

type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

type WorkspaceStat = {
  path: string;
  type: "directory" | "file";
  size: number | null;
  createdAt: number;
  updatedAt: number;
};

type RevisionInfo = {
  revisionId: string;
  createdAt: number;
};

type WorkspaceOperationError = { tag: string };

type WorkspaceReadableFiles = {
  read(path: string): Promise<BetterResult<Uint8Array, WorkspaceOperationError>>;
  list(path: string): Promise<BetterResult<WorkspaceEntry[], WorkspaceOperationError>>;
  stat(path: string): Promise<BetterResult<WorkspaceStat, WorkspaceOperationError>>;
};

type ImageState =
  | { exists: true; path: string; bytes: number; updatedAt: number; contentType?: string }
  | { exists: false };

type DraftState =
  | { exists: true; draftEditId: string; path: string; bytes: number; updatedAt: number; contentType?: string }
  | { exists: false; draftEditId?: string };

export type PhotoState = {
  workspaceName: string;
  original: ImageState;
  current: ImageState;
  draft: DraftState;
  files: WorkspaceEntry[];
};

export type PhotoDraftControllerDependencies = {
  workspaceName: string;
  workspaces: WorkspaceNamespace;
  commandRunner: Pick<DemoWorkspaceCommandRunner, "runWorkspaceCommand">;
  dynamicWorkerRunner: WorkspaceDynamicWorkerRunner;
  workspaceForDraft(draftEditId: string): ScopedWorkspaceFileCapability;
  getDraftEditId(): string | undefined;
  setDraftEditId(draftEditId: string | undefined): void;
};

export class PhotoDraftController {
  constructor(private readonly dependencies: PhotoDraftControllerDependencies) {}

  async listPhotoState(): Promise<PhotoState> {
    const workspace = this.workspace();
    const draftEditId = this.dependencies.getDraftEditId();
    const [original, current, files, draft] = await Promise.all([
      this.readOriginalState(workspace.files),
      this.readImageState(workspace.files, CURRENT_PATH),
      this.listWorkspaceFiles(),
      this.readDraftState(draftEditId),
    ]);

    return {
      workspaceName: this.dependencies.workspaceName,
      original,
      current,
      draft,
      files,
    };
  }

  async startDraft(): Promise<{
    status: "draft-ready";
    draftEditId: string;
    message: string;
  }> {
    const existing = this.dependencies.getDraftEditId();
    if (existing) {
      return {
        status: "draft-ready",
        draftEditId: existing,
        message: "Draft edit is ready.",
      };
    }

    const copy = await expectOkResult(this.workspace().files.copy("photo-draft"), "start draft edit");
    this.dependencies.setDraftEditId(copy.id);

    return {
      status: "draft-ready",
      draftEditId: copy.id,
      message: "Draft edit is ready.",
    };
  }

  async runWorkspaceCommand({ command }: { command: string }): Promise<{
    status: "command-completed";
    root: string;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    capture: WorkspaceFileCaptureSummary;
  }> {
    return this.withDraftCopy(async (copy, draftEditId) => {
      const result = await this.dependencies.commandRunner.runWorkspaceCommand({
        files: copy.files,
        command,
        root: WORKSPACE_ROOT,
        draftEditId,
      });

      return {
        status: "command-completed",
        root: result.root,
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        capture: result.capture,
      };
    });
  }

  async runDynamicWorker({ code }: { code: string }): Promise<{
    status: "dynamic-worker-completed";
    summary: string;
    result: WorkspaceDynamicWorkerResult;
  }> {
    return this.withDraftCopy(async (_copy, draftEditId) => {
      const result = await this.dependencies.dynamicWorkerRunner.run({
        code,
        workspace: this.dependencies.workspaceForDraft(draftEditId),
      });
      if (Result.isError(result)) {
        throw new Error(result.error.message);
      }

      return {
        status: "dynamic-worker-completed",
        summary: "Dynamic Worker finished.",
        result: result.value,
      };
    });
  }

  async previewDraft(): Promise<{
    status: "draft-preview-ready";
    draftEditId: string;
    path: string;
    bytes: number;
  }> {
    const draftEditId = this.dependencies.getDraftEditId();
    if (!draftEditId) {
      throw new Error("No draft edit exists. Start a draft edit first.");
    }

    return this.withDraftCopy(async (copy) => {
      const bytes = await expectOkResult(copy.files.read(CURRENT_PATH), "read draft preview");

      return {
        status: "draft-preview-ready",
        draftEditId,
        path: CURRENT_PATH,
        bytes: bytes.byteLength,
      };
    });
  }

  async readDraftImage(): Promise<RpcResult<Uint8Array>> {
    const draftEditId = this.dependencies.getDraftEditId();
    if (!draftEditId) {
      return { status: "error", error: { tag: "PathNotFoundError" } };
    }

    const copy = await this.workspace().files.getCopy(draftEditId);
    if (Result.isError(copy)) {
      this.dependencies.setDraftEditId(undefined);
      return { status: "error", error: { tag: "PathNotFoundError" } };
    }

    return resultToRpc(await copy.value.files.read(CURRENT_PATH));
  }

  async commitDraft(): Promise<{
    status: "current-updated";
    revisionId: string;
    createdAt: number;
    message: string;
  }> {
    return this.withDraftCopy(async (copy) => {
      const revision = await expectOkResult(copy.apply(), "make draft edit current") as RevisionInfo;
      this.dependencies.setDraftEditId(undefined);

      return {
        status: "current-updated",
        revisionId: revision.revisionId,
        createdAt: revision.createdAt,
        message: "Draft edit is now the current version.",
      };
    });
  }

  async discardDraft(): Promise<{
    status: "draft-discarded";
    message: string;
  }> {
    return this.withDraftCopy(async (copy) => {
      await expectOkResult(copy.discard(), "throw away draft edit");
      this.dependencies.setDraftEditId(undefined);

      return {
        status: "draft-discarded",
        message: "Draft edit was thrown away.",
      };
    });
  }

  async listWorkspaceFiles(): Promise<WorkspaceEntry[]> {
    const draftEditId = this.dependencies.getDraftEditId();
    if (!draftEditId) {
      return this.listWorkspaceRoots(this.workspace().files);
    }

    const copy = await this.workspace().files.getCopy(draftEditId);
    if (Result.isError(copy)) {
      this.dependencies.setDraftEditId(undefined);
      return this.listWorkspaceRoots(this.workspace().files);
    }

    return this.listWorkspaceRoots(copy.value.files);
  }

  private async listWorkspaceRoots(source: Pick<WorkspaceReadableFiles, "list">): Promise<WorkspaceEntry[]> {
    const entries = await Promise.all([this.listWorkspaceRoot(source, "/notes"), this.listWorkspaceRoot(source, "/photos")]);
    return entries.flat().sort((left, right) => left.path.localeCompare(right.path));
  }

  private async listWorkspaceRoot(source: Pick<WorkspaceReadableFiles, "list">, path: string): Promise<WorkspaceEntry[]> {
    const result = await source.list(path);
    if (Result.isError(result)) {
      if (result.error.tag === "PathNotFoundError") {
        return [];
      }
      throw new Error(`list workspace files failed with ${result.error.tag}`);
    }

    return result.value;
  }

  private workspace(): Workspace {
    return Workspace.get(this.dependencies.workspaces, this.dependencies.workspaceName);
  }

  private async withDraftCopy<T>(useCopy: (copy: WorkspaceFileCopy, draftEditId: string) => Promise<T>): Promise<T> {
    const started = await this.startDraft();
    const copy = await this.workspace().files.getCopy(started.draftEditId);
    if (Result.isError(copy)) {
      this.dependencies.setDraftEditId(undefined);
      throw new Error(`draft edit not found: ${copy.error.tag}`);
    }

    return useCopy(copy.value, started.draftEditId);
  }

  private async readOriginalState(files: WorkspaceReadableFiles): Promise<ImageState> {
    for (const candidate of ORIGINAL_CANDIDATES) {
      const state = await this.readImageState(files, candidate.path, candidate.contentType);
      if (state.exists) {
        return state;
      }
    }

    return { exists: false };
  }

  private async readImageState(
    files: WorkspaceReadableFiles,
    path: string,
    contentType?: string,
  ): Promise<ImageState> {
    const result = await files.stat(path);
    if (!Result.isError(result)) {
      const detectedContentType = contentType ?? await readImageContentType(files, path);
      return {
        exists: true,
        path,
        bytes: result.value.size ?? 0,
        updatedAt: result.value.updatedAt,
        contentType: detectedContentType,
      };
    }

    if (result.error.tag === "PathNotFoundError") {
      return { exists: false };
    }

    throw new Error(`read ${path} state failed with ${result.error.tag}`);
  }

  private async readDraftState(draftEditId: string | undefined): Promise<DraftState> {
    if (!draftEditId) {
      return { exists: false };
    }

    const copy = await this.workspace().files.getCopy(draftEditId);
    if (Result.isError(copy)) {
      this.dependencies.setDraftEditId(undefined);
      return { exists: false };
    }

    const stat = await copy.value.files.stat(CURRENT_PATH);
    if (Result.isError(stat)) {
      if (stat.error.tag === "PathNotFoundError") {
        return { exists: false, draftEditId };
      }
      throw new Error(`read draft edit state failed with ${stat.error.tag}`);
    }

    const image = await copy.value.files.read(CURRENT_PATH);
    if (Result.isError(image)) {
      throw new Error(`read draft image content type failed with ${image.error.tag}`);
    }

    return {
      exists: true,
      draftEditId,
      path: CURRENT_PATH,
      bytes: stat.value.size ?? 0,
      updatedAt: stat.value.updatedAt,
      contentType: contentTypeForImage(image.value),
    };
  }
}

async function readImageContentType(files: WorkspaceReadableFiles, path: string): Promise<string> {
  const result = await files.read(path);
  if (Result.isError(result)) {
    throw new Error(`read ${path} content type failed with ${result.error.tag}`);
  }

  return contentTypeForImage(result.value);
}

function contentTypeForImage(contents: Uint8Array): string {
  if (contents[0] === 0x89 && contents[1] === 0x50 && contents[2] === 0x4e && contents[3] === 0x47) {
    return "image/png";
  }

  if (contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff) {
    return "image/jpeg";
  }

  return "application/octet-stream";
}

async function expectOkResult<T, E extends { tag: string }>(pending: Promise<BetterResult<T, E>>, operation: string): Promise<T> {
  const result = await pending;
  if (Result.isError(result)) {
    throw new Error(`${operation} failed with ${result.error.tag}`);
  }

  return result.value;
}

function resultToRpc<T>(result: BetterResult<T, WorkspaceOperationError>): RpcResult<T> {
  if (Result.isError(result)) {
    return { status: "error", error: result.error };
  }

  if (result.value === undefined) {
    return { status: "ok" };
  }

  return { status: "ok", value: result.value };
}
