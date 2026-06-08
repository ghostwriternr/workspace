import { Result, type Result as BetterResult } from "better-result";
import { Workspace, type WorkspaceCurrentFileError } from "@cloudflare/workspace";

type PhotoArtifactsBinding = Parameters<typeof Workspace.fromArtifacts>[0] & {
  create(name: string, opts?: { description?: string; setDefaultBranch?: string }): Promise<unknown>;
};

type WorkspaceForUpload = {
  mkdir(path: string): Promise<BetterResult<void, WorkspaceCurrentFileError>>;
  write(path: string, contents: Uint8Array): Promise<BetterResult<void, WorkspaceCurrentFileError>>;
};

export type OriginalPhotoUpload = {
  workspaceName: string;
  path: string;
  contentType: string;
  bytes: number;
};

export type UploadOriginalPhotoOptions = {
  artifacts: PhotoArtifactsBinding;
  workspaceName: string;
  contents: Uint8Array;
  contentType: string;
};

export async function uploadOriginalPhoto({
  artifacts,
  workspaceName,
  contents,
  contentType,
}: UploadOriginalPhotoOptions): Promise<OriginalPhotoUpload> {
  const path = photoPathForContentType(contentType);
  await ensurePhotoRepository(artifacts, workspaceName);
  const workspace = Workspace.fromArtifacts(artifacts, workspaceName);

  await ensurePhotosDirectory(workspace.files);
  await expectOk(workspace.files.write(path, contents), "write uploaded original photo");

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

async function ensurePhotoRepository(artifacts: PhotoArtifactsBinding, workspaceName: string): Promise<void> {
  try {
    await artifacts.get(workspaceName);
    return;
  } catch (error) {
    if (!isArtifactsNotFound(error)) {
      throw error;
    }

    await artifacts.create(workspaceName, {
      description: `Photo Workspace ${workspaceName}`,
      setDefaultBranch: "main",
    });
  }
}

function isArtifactsNotFound(error: unknown): boolean {
  return error instanceof Error &&
    (error as { name?: unknown; code?: unknown }).name === "ArtifactsError" &&
    (error as { code?: unknown }).code === "NOT_FOUND";
}

async function ensurePhotosDirectory(workspace: WorkspaceForUpload): Promise<void> {
  const result = await workspace.mkdir("/photos");
  if (Result.isOk(result)) {
    return;
  }

  if (result.error.tag === "PathAlreadyExistsError") {
    return;
  }

  throw new Error(`create /photos directory failed with ${result.error.tag}`);
}

async function expectOk<T, E extends { tag: string }>(pending: Promise<BetterResult<T, E>>, operation: string): Promise<T> {
  const result = await pending;
  if (Result.isError(result)) {
    throw new Error(`${operation} failed with ${result.error.tag}`);
  }

  return result.value;
}
