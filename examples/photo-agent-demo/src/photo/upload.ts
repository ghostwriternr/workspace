import { Result, type Result as BetterResult } from "better-result";
import { Workspace, type WorkspaceCurrentFileError, type WorkspaceObjectClient } from "@cloudflare/workspace";

type PhotoArtifactsBinding = Parameters<typeof Workspace.fromArtifacts>[0]["artifacts"] & {
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
  workspaceObject: WorkspaceObjectClient;
  workspaceName: string;
  contents: Uint8Array;
  contentType: string;
};

export async function uploadOriginalPhoto({
  artifacts,
  workspaceObject,
  workspaceName,
  contents,
  contentType,
}: UploadOriginalPhotoOptions): Promise<OriginalPhotoUpload> {
  const path = photoPathForContentType(contentType);
  await ensurePhotoRepository(artifacts, workspaceObject, workspaceName);
  const workspace = Workspace.fromArtifacts({ artifacts, object: workspaceObject, name: workspaceName });

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

async function ensurePhotoRepository(artifacts: PhotoArtifactsBinding, workspaceObject: WorkspaceObjectClient, workspaceName: string): Promise<void> {
  try {
    await artifacts.get(workspaceName);
    return;
  } catch (error) {
    if (!isArtifactsNotFound(error)) {
      throw error;
    }

    const created = await artifacts.create(workspaceName, {
      description: `Photo Workspace ${workspaceName}`,
      setDefaultBranch: "main",
    });
    const access = workspaceAccessFrom(created, "main");
    if (!access) {
      throw new Error("Artifacts create response did not include repository access metadata.");
    }
    await workspaceObject.recordCurrentRepository({ repository: workspaceName, ...access });
  }
}

function workspaceAccessFrom(value: unknown, fallbackDefaultBranch: string): { remote: string; defaultBranch: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const remote = (value as { remote?: unknown }).remote;
  const defaultBranch = (value as { defaultBranch?: unknown }).defaultBranch;
  if (typeof remote !== "string") return undefined;
  return {
    remote,
    defaultBranch: typeof defaultBranch === "string" ? defaultBranch : fallbackDefaultBranch,
  };
}

function isArtifactsNotFound(error: unknown): boolean {
  if (typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown; code?: unknown }).name === "ArtifactsError" &&
    (error as { code?: unknown }).code === "NOT_FOUND") {
    return true;
  }

  return error instanceof Error && error.message.startsWith("ArtifactsError: Repository not found:");
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
