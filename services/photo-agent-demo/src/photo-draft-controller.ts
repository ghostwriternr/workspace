import type { WorkspaceMountFlushSummary, WorkspaceMountWorkingCopy } from "../../control-plane/src/workspace/working-copy-mount";
import type { DemoWorkspaceCommandRunner } from "./workspace/sandbox-workspace-command-runner";
import type { DemoDynamicWorkerRunner, DynamicWorkerResult } from "./workspace/dynamic-worker-runner";
import { disposeRpc, disposeRpcResult } from "./workspace/rpc-disposal";

const ORIGINAL_CANDIDATES = [
  { path: "/photos/original.png", contentType: "image/png" },
  { path: "/photos/original.jpg", contentType: "image/jpeg" },
] as const;
const CURRENT_PATH = "/photos/current";
const WORKSPACE_ROOT = "/workspace";

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string } };

type WorkspaceNamespace = {
  getByName(name: string): WorkspaceForDrafts;
};

type WorkspaceForDrafts = {
  readFile(path: string): Promise<RpcResult<Uint8Array>>;
  stat(path: string): Promise<RpcResult<WorkspaceStat>>;
  list(path: string): Promise<RpcResult<WorkspaceEntry[]>>;
  beginSession(): Promise<WorkspaceSessionForDrafts>;
  getSession(sessionId: string): Promise<RpcResult<WorkspaceSessionForDrafts>>;
};

type WorkspaceSessionForDrafts = WorkspaceMountWorkingCopy & {
  info(): Promise<RpcResult<SessionInfo>>;
  stat(path: string): Promise<RpcResult<WorkspaceStat>>;
  commit(): Promise<RpcResult<RevisionInfo>>;
  discard(): Promise<RpcResult>;
};

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

type SessionInfo = {
  sessionId: string;
  createdAt: number;
};

type RevisionInfo = {
  revisionId: string;
  createdAt: number;
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
  dynamicWorkerRunner: Pick<DemoDynamicWorkerRunner, "runDynamicWorker">;
  getDraftEditId(): string | undefined;
  setDraftEditId(draftEditId: string | undefined): void;
};

export class PhotoDraftController {
  constructor(private readonly dependencies: PhotoDraftControllerDependencies) {}

  async listPhotoState(): Promise<PhotoState> {
    const workspace = this.workspace();
    const draftEditId = this.dependencies.getDraftEditId();
    const [original, current, files, draft] = await Promise.all([
      this.readOriginalState(workspace),
      this.readHeadImageState(workspace, CURRENT_PATH),
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

    const session = await this.workspace().beginSession();
    try {
      const info = await expectOk(session.info(), "read draft edit info");
      this.dependencies.setDraftEditId(info.sessionId);

      return {
        status: "draft-ready",
        draftEditId: info.sessionId,
        message: "Draft edit is ready.",
      };
    } finally {
      disposeRpc(session);
    }
  }

  async runWorkspaceCommand({ command }: { command: string }): Promise<{
    status: "command-completed";
    root: string;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    flush: WorkspaceMountFlushSummary;
  }> {
    return this.withDraftSession(async (session) => {
      const result = await this.dependencies.commandRunner.runWorkspaceCommand({
        workingCopy: session,
        command,
        root: WORKSPACE_ROOT,
      });

      return {
        status: "command-completed",
        root: result.root,
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        flush: result.flush,
      };
    });
  }

  async runDynamicWorker({ code }: { code: string }): Promise<{
    status: "dynamic-worker-completed";
    summary: string;
    result: DynamicWorkerResult;
  }> {
    return this.withDraftSession(async (_session, draftEditId) => {
      const result = await this.dependencies.dynamicWorkerRunner.runDynamicWorker({
        draftEditId,
        code,
      });

      return {
        status: "dynamic-worker-completed",
        summary: "Dynamic Worker finished.",
        result,
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

    return this.withDraftSession(async (session) => {
      const bytes = await expectOk(session.readFile(CURRENT_PATH), "read draft preview");

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

    const sessionResult = await this.workspace().getSession(draftEditId);
    try {
      if (sessionResult.status === "error") {
        this.dependencies.setDraftEditId(undefined);
        return { status: "error", error: { tag: "PathNotFoundError" } };
      }

      return await sessionResult.value!.readFile(CURRENT_PATH);
    } finally {
      disposeRpcResult(sessionResult);
    }
  }

  async commitDraft(): Promise<{
    status: "current-updated";
    revisionId: string;
    createdAt: number;
    message: string;
  }> {
    return this.withDraftSession(async (session) => {
      const revision = await expectOk(session.commit(), "make draft edit current");
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
    return this.withDraftSession(async (session) => {
      await expectOk(session.discard(), "throw away draft edit");
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
      return this.listWorkspaceRoots(this.workspace());
    }

    const result = await this.workspace().getSession(draftEditId);
    try {
      if (result.status === "error") {
        this.dependencies.setDraftEditId(undefined);
        return this.listWorkspaceRoots(this.workspace());
      }

      return this.listWorkspaceRoots(result.value!);
    } finally {
      disposeRpcResult(result);
    }
  }

  private async listWorkspaceRoots(source: Pick<WorkspaceForDrafts, "list">): Promise<WorkspaceEntry[]> {
    const entries = await Promise.all([this.listWorkspaceRoot(source, "/notes"), this.listWorkspaceRoot(source, "/photos")]);
    return entries.flat().sort((left, right) => left.path.localeCompare(right.path));
  }

  private async listWorkspaceRoot(source: Pick<WorkspaceForDrafts, "list">, path: string): Promise<WorkspaceEntry[]> {
    const result = await source.list(path);
    if (result.status === "error") {
      if (result.error.tag === "PathNotFoundError") {
        return [];
      }
      throw new Error(`list workspace files failed with ${result.error.tag}`);
    }

    return result.value ?? [];
  }

  private workspace(): WorkspaceForDrafts {
    return this.dependencies.workspaces.getByName(this.dependencies.workspaceName);
  }

  private async withDraftSession<T>(useSession: (session: WorkspaceSessionForDrafts, draftEditId: string) => Promise<T>): Promise<T> {
    const started = await this.startDraft();
    const result = await this.workspace().getSession(started.draftEditId);
    try {
      if (result.status === "error") {
        this.dependencies.setDraftEditId(undefined);
        throw new Error(`draft edit not found: ${result.error.tag}`);
      }

      return await useSession(result.value!, started.draftEditId);
    } finally {
      disposeRpcResult(result);
    }
  }

  private async readOriginalState(workspace: WorkspaceForDrafts): Promise<ImageState> {
    for (const candidate of ORIGINAL_CANDIDATES) {
      const state = await this.readHeadImageState(workspace, candidate.path, candidate.contentType);
      if (state.exists) {
        return state;
      }
    }

    return { exists: false };
  }

  private async readHeadImageState(
    workspace: WorkspaceForDrafts,
    path: string,
    contentType?: string,
  ): Promise<ImageState> {
    const result = await workspace.stat(path);
    if (result.status === "ok") {
      const detectedContentType = contentType ?? await readHeadImageContentType(workspace, path);
      return {
        exists: true,
        path,
        bytes: result.value!.size ?? 0,
        updatedAt: result.value!.updatedAt,
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

    const result = await this.workspace().getSession(draftEditId);
    try {
      if (result.status === "error") {
        this.dependencies.setDraftEditId(undefined);
        return { exists: false };
      }

      const stat = await result.value!.stat(CURRENT_PATH);
      if (stat.status === "error") {
        if (stat.error.tag === "PathNotFoundError") {
          return { exists: false, draftEditId };
        }
        throw new Error(`read draft edit state failed with ${stat.error.tag}`);
      }

      const image = await result.value!.readFile(CURRENT_PATH);
      if (image.status === "error") {
        throw new Error(`read draft image content type failed with ${image.error.tag}`);
      }

      return {
        exists: true,
        draftEditId,
        path: CURRENT_PATH,
        bytes: stat.value!.size ?? 0,
        updatedAt: stat.value!.updatedAt,
        contentType: contentTypeForImage(image.value!),
      };
    } finally {
      disposeRpcResult(result);
    }
  }
}

async function readHeadImageContentType(workspace: WorkspaceForDrafts, path: string): Promise<string> {
  const result = await workspace.readFile(path);
  if (result.status === "error") {
    throw new Error(`read ${path} content type failed with ${result.error.tag}`);
  }

  return contentTypeForImage(result.value!);
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

async function expectOk<T>(pending: Promise<RpcResult<T>>, operation: string): Promise<T> {
  const result = await pending;
  if (result.status === "error") {
    throw new Error(`${operation} failed with ${result.error.tag}`);
  }

  return result.value as T;
}
