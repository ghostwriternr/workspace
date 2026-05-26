type WorkspaceNamespace = {
  getByName(name: string): WorkspaceForRead;
};

type WorkspaceForRead = {
  readFile(path: string): Promise<
    | { status: "ok"; value: Uint8Array }
    | { status: "error"; error: { tag: string } }
  >;
};

const readRoutePattern = /^\/api\/workspaces\/([^/]+)\/photos\/(original|current)$/;

export async function handlePhotoReadRequest(
  request: Request,
  workspaces: WorkspaceNamespace,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = readRoutePattern.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const workspace = workspaces.getByName(decodeURIComponent(match[1]));
  const target = match[2];
  const candidates = target === "original"
    ? [
        { path: "/photos/original.png", contentType: "image/png" },
        { path: "/photos/original.jpg", contentType: "image/jpeg" },
      ]
    : [{ path: "/photos/current.png", contentType: "image/png" }];

  for (const candidate of candidates) {
    const result = await workspace.readFile(candidate.path);
    if (result.status === "ok") {
      return new Response(result.value, {
        headers: {
          "cache-control": "no-store",
          "content-type": candidate.contentType,
        },
      });
    }

    if (result.error.tag !== "PathNotFoundError") {
      throw new Error(`read ${candidate.path} failed with ${result.error.tag}`);
    }
  }

  return Response.json({ error: "Photo not found" }, { status: 404 });
}
