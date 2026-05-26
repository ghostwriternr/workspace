type PhotoAgentNamespace = {
  getByName(name: string): PhotoAgentForState;
};

type PhotoAgentForState = {
  photoState(): Promise<unknown>;
};

const stateRoutePattern = /^\/api\/workspaces\/([^/]+)\/photo-state$/;

export async function handlePhotoStateRequest(
  request: Request,
  photoAgents: PhotoAgentNamespace,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = stateRoutePattern.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const workspaceName = decodeURIComponent(match[1]);
  const state = await photoAgents.getByName(workspaceName).photoState();
  return Response.json(state, {
    headers: { "cache-control": "no-store" },
  });
}
