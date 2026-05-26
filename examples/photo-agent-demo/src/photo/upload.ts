type WorkspaceNamespace = {
  getByName(name: string): WorkspaceForUpload;
};

type WorkspaceForUpload = {
  mkdir(path: string): Promise<{ status: "ok" } | { status: "error"; error: { tag: string } }>;
  writeFile(path: string, contents: Uint8Array): Promise<RpcResult>;
};

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string } };

export type OriginalPhotoUpload = {
  workspaceName: string;
  path: string;
  contentType: string;
  bytes: number;
};

export type UploadOriginalPhotoOptions = {
  workspaces: WorkspaceNamespace;
  workspaceName: string;
  contents: Uint8Array;
  contentType: string;
};

export async function uploadOriginalPhoto({
  workspaces,
  workspaceName,
  contents,
  contentType,
}: UploadOriginalPhotoOptions): Promise<OriginalPhotoUpload> {
  const path = photoPathForContentType(contentType);
  const workspace = workspaces.getByName(workspaceName);

  await ensurePhotosDirectory(workspace);
  await expectOk(workspace.writeFile(path, contents), "write uploaded original photo");

  return {
    workspaceName,
    path,
    contentType: normalizedContentType(contentType),
    bytes: contents.byteLength,
  };
}

export function photoPathForContentType(contentType: string): string {
  const normalized = normalizedContentType(contentType);

  if (normalized === "image/png") {
    return "/photos/original.png";
  }

  if (normalized === "image/jpeg") {
    return "/photos/original.jpg";
  }

  throw new Error(`Unsupported photo content type: ${contentType}`);
}

function normalizedContentType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function ensurePhotosDirectory(workspace: WorkspaceForUpload): Promise<void> {
  const result = await workspace.mkdir("/photos");
  if (result.status === "ok") {
    return;
  }

  if (result.error.tag === "PathAlreadyExistsError") {
    return;
  }

  throw new Error(`create /photos directory failed with ${result.error.tag}`);
}

async function expectOk<T>(pending: Promise<RpcResult<T>>, operation: string): Promise<T> {
  const result = await pending;
  if (result.status === "error") {
    throw new Error(`${operation} failed with ${result.error.tag}`);
  }

  return result.value as T;
}
