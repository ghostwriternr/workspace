import type { DemoImageEditor } from "./image/sandbox-image-editor";

const ORIGINAL_CANDIDATES = [
  { path: "/photos/original.png", contentType: "image/png" },
  { path: "/photos/original.jpg", contentType: "image/jpeg" },
] as const;
const CURRENT_PATH = "/photos/current";

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

type WorkspaceSessionForDrafts = {
  info(): Promise<RpcResult<SessionInfo>>;
  readFile(path: string): Promise<RpcResult<Uint8Array>>;
  writeFile(path: string, contents: Uint8Array): Promise<RpcResult>;
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
  imageEditor: Pick<DemoImageEditor, "runSandboxCommand" | "readSandboxFile">;
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

  async readOriginalImage(): Promise<{
    path: string;
    contentType: string;
    bytes: number;
    contents: Uint8Array;
  }> {
    return readUploadedOriginal(this.workspace());
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

  async runSandboxCommand({ command }: { command: string }): Promise<{
    status: "command-completed";
    inputPath: string;
    inputFilename: string;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const input = await this.readSandboxInput();
    const result = await this.dependencies.imageEditor.runSandboxCommand({
      input: input.contents,
      inputFilename: filenameForWorkspacePath(input.path),
      command,
    });

    return {
      status: "command-completed",
      inputPath: input.path,
      inputFilename: filenameForWorkspacePath(input.path),
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async saveDraftFromSandboxFile({ filename }: { filename: string }): Promise<{
    status: "draft-updated";
    draftPath: string;
    filename: string;
    outputBytes: number;
  }> {
    return this.withDraftSession(async (session) => {
      const contents = await this.dependencies.imageEditor.readSandboxFile(filename);
      await expectOk(session.writeFile(CURRENT_PATH, contents), "write draft edit");

      return {
        status: "draft-updated",
        draftPath: CURRENT_PATH,
        filename,
        outputBytes: contents.byteLength,
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
      disposeRpc(sessionResult);
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
    const result = await this.workspace().list("/photos");
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

  private async readSandboxInput(): Promise<{
    path: string;
    contents: Uint8Array;
  }> {
    const draftEditId = this.dependencies.getDraftEditId();
    if (draftEditId) {
      const sessionResult = await this.workspace().getSession(draftEditId);
      try {
        if (sessionResult.status === "ok") {
          const current = await sessionResult.value!.readFile(CURRENT_PATH);
          if (current.status === "ok") {
            return { path: CURRENT_PATH, contents: current.value! };
          }
          if (current.error.tag !== "PathNotFoundError") {
            throw new Error(`read current draft input failed with ${current.error.tag}`);
          }
        } else {
          this.dependencies.setDraftEditId(undefined);
        }
      } finally {
        disposeRpc(sessionResult);
      }
    }

    return readHeadInput(this.workspace());
  }

  private async withDraftSession<T>(useSession: (session: WorkspaceSessionForDrafts) => Promise<T>): Promise<T> {
    const started = await this.startDraft();
    const result = await this.workspace().getSession(started.draftEditId);
    try {
      if (result.status === "error") {
        this.dependencies.setDraftEditId(undefined);
        throw new Error(`draft edit not found: ${result.error.tag}`);
      }

      return await useSession(result.value!);
    } finally {
      disposeRpc(result);
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
      disposeRpc(result);
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

async function readHeadInput(workspace: WorkspaceForDrafts): Promise<{
  path: string;
  contents: Uint8Array;
}> {
  const current = await workspace.readFile(CURRENT_PATH);
  if (current.status === "ok") {
    return { path: CURRENT_PATH, contents: current.value! };
  }

  if (current.error.tag !== "PathNotFoundError") {
    throw new Error(`read current image failed with ${current.error.tag}`);
  }

  const original = await readUploadedOriginal(workspace);
  return { path: original.path, contents: original.contents };
}

async function readUploadedOriginal(workspace: WorkspaceForDrafts): Promise<{
  path: string;
  contentType: string;
  bytes: number;
  contents: Uint8Array;
}> {
  for (const candidate of ORIGINAL_CANDIDATES) {
    const result = await workspace.readFile(candidate.path);
    if (result.status === "ok") {
      return {
        path: candidate.path,
        contentType: candidate.contentType,
        bytes: result.value!.byteLength,
        contents: result.value!,
      };
    }

    if (result.error.tag !== "PathNotFoundError") {
      throw new Error(`read original image failed with ${result.error.tag}`);
    }
  }

  throw new Error("No uploaded original photo found");
}

async function readDraftInput(session: WorkspaceSessionForDrafts): Promise<{
  path: string;
  contents: Uint8Array;
}> {
  const current = await session.readFile(CURRENT_PATH);
  if (current.status === "ok") {
    return { path: CURRENT_PATH, contents: current.value! };
  }

  if (current.error.tag !== "PathNotFoundError") {
    throw new Error(`read current draft input failed with ${current.error.tag}`);
  }

  for (const candidate of ORIGINAL_CANDIDATES) {
    const original = await session.readFile(candidate.path);
    if (original.status === "ok") {
      return { path: candidate.path, contents: original.value! };
    }

    if (original.error.tag !== "PathNotFoundError") {
      throw new Error(`read original draft input failed with ${original.error.tag}`);
    }
  }

  throw new Error("No uploaded original photo found");
}

async function expectOk<T>(pending: Promise<RpcResult<T>>, operation: string): Promise<T> {
  const result = await pending;
  if (result.status === "error") {
    throw new Error(`${operation} failed with ${result.error.tag}`);
  }

  return result.value as T;
}

function disposeRpc(value: unknown): void {
  const disposable = value as { [Symbol.dispose]?: () => void };
  disposable[Symbol.dispose]?.();
}

function filenameForWorkspacePath(path: string): string {
  const filename = path.split("/").at(-1);
  if (!filename) {
    throw new Error(`Could not derive filename from ${path}`);
  }

  return filename;
}
