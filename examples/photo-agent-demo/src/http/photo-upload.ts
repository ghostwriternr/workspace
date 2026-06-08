import { uploadOriginalPhoto } from "../photo/upload";

type PhotoArtifactsBinding = Parameters<typeof uploadOriginalPhoto>[0]["artifacts"];
type WorkspaceObjectNamespace = {
  getByName(name: string): Parameters<typeof uploadOriginalPhoto>[0]["workspaceObject"];
};

type PhotoAgentNamespace = {
  getByName(name: string): { refreshPhotoState(): Promise<unknown> };
};

const uploadRoutePattern = /^\/api\/workspaces\/([^/]+)\/photos\/original$/;

export async function handlePhotoUploadRequest(
  request: Request,
  artifacts: PhotoArtifactsBinding,
  workspaceObjects: WorkspaceObjectNamespace,
  photoAgents?: PhotoAgentNamespace,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = uploadRoutePattern.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  if (request.method !== "POST") {
    return undefined;
  }

  const workspaceName = decodeURIComponent(match[1]);
  const contentType = request.headers.get("content-type") ?? "";
  const contents = new Uint8Array(await request.arrayBuffer());

  try {
    const upload = await uploadOriginalPhoto({
      artifacts,
      workspaceObject: workspaceObjects.getByName(workspaceName),
      workspaceName,
      contents,
      contentType,
    });
    if (photoAgents) {
      await photoAgents.getByName(workspaceName).refreshPhotoState();
    }

    return Response.json(upload, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unsupported photo content type:")) {
      return Response.json({ error: error.message }, { status: 415 });
    }

    throw error;
  }
}
