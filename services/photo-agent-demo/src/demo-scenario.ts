import type { DemoImageEditor, DemoImageOperation } from "./image/sandbox-image-editor";

type WorkspaceNamespace = {
  getByName(name: string): WorkspaceForScenario;
};

type WorkspaceForScenario = {
  readFile(path: string): Promise<RpcResult<Uint8Array>>;
  beginSession(): Promise<WorkspaceSessionForScenario>;
};

type WorkspaceSessionForScenario = {
  info(): Promise<RpcResult<SessionInfo>>;
  writeFile(path: string, contents: Uint8Array): Promise<RpcResult>;
  commit(): Promise<RpcResult<Revision>>;
};

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string } };

type SessionInfo = {
  sessionId: string;
  createdAt: number;
};

type Revision = {
  revisionId: string;
  createdAt: number;
};

export type DemoScenarioReport = {
  workspaceName: string;
  originalPath: string;
  currentPath: string;
  operation: DemoImageOperation;
  originalBytes: number;
  currentBytes: number;
  committed: boolean;
  session: {
    sessionId: string;
    createdAt: number;
  };
  revision: {
    revisionId: string;
    createdAt: number;
  };
};

export type DemoScenarioOptions = {
  workspaces: WorkspaceNamespace;
  imageEditor: DemoImageEditor;
  workspaceName?: string;
};

export async function runDemoScenario({
  workspaces,
  imageEditor,
  workspaceName = `photo-demo-${crypto.randomUUID()}`,
}: DemoScenarioOptions): Promise<DemoScenarioReport> {
  const workspace = workspaces.getByName(workspaceName);
  const uploadedOriginal = await readUploadedOriginal(workspace);

  const session = await workspace.beginSession();
  const sessionInfo = await expectOk<SessionInfo>(session.info(), "read draft session info");
  const draft = await imageEditor.makeDraftEdit(uploadedOriginal.contents);

  await expectOk(session.writeFile("/photos/current.png", draft.contents), "write draft edit");

  const revision = await expectOk<Revision>(session.commit(), "commit draft edit");

  return {
    workspaceName,
    originalPath: uploadedOriginal.path,
    currentPath: "/photos/current.png",
    operation: draft.operation,
    originalBytes: uploadedOriginal.contents.byteLength,
    currentBytes: draft.contents.byteLength,
    committed: true,
    session: sessionInfo,
    revision,
  };
}

async function readUploadedOriginal(
  workspace: WorkspaceForScenario,
): Promise<{ path: string; contents: Uint8Array }> {
  for (const path of ["/photos/original.png", "/photos/original.jpg"]) {
    const result = await workspace.readFile(path);
    if (result.status === "ok") {
      return { path, contents: result.value! };
    }

    if (result.error.tag !== "PathNotFoundError") {
      throw new Error(`read uploaded original failed with ${result.error.tag}`);
    }
  }

  throw new Error("No uploaded original photo found");
}

async function expectOk<T>(
  pending: Promise<RpcResult<T>>,
  operation: string,
): Promise<T> {
  const result = await pending;
  if (result.status === "error") {
    throw new Error(`${operation} failed with ${result.error.tag}`);
  }

  return result.value as T;
}
