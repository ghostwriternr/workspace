type WorkspaceNamespace = {
  getByName(name: string): WorkspaceForRead;
};

type PhotoAgentNamespace = {
  getByName(name: string): PhotoAgentForRead;
};

type WorkspaceForRead = {
  readFile(path: string): Promise<
    | { status: "ok"; value: Uint8Array }
    | { status: "error"; error: { tag: string } }
  >;
};

type PhotoAgentForRead = {
  readDraftImage(): Promise<
    | { status: "ok"; value?: Uint8Array }
    | { status: "error"; error: { tag: string } }
  >;
};

const readRoutePattern = /^\/api\/workspaces\/([^/]+)\/photos\/(original|current|draft)$/;

export async function handlePhotoReadRequest(
  request: Request,
  workspaces: WorkspaceNamespace,
  photoAgents?: PhotoAgentNamespace,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = readRoutePattern.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const workspaceName = decodeURIComponent(match[1]);
  const workspace = workspaces.getByName(workspaceName);
  const target = match[2];

  if (target === "draft") {
    if (!photoAgents) {
      return Response.json({ error: "Photo not found" }, { status: 404 });
    }

    const result = await photoAgents.getByName(workspaceName).readDraftImage();
    if (result.status === "ok" && result.value) {
      return imageResponse(result.value, contentTypeForImage(result.value));
    }

    if (result.status === "error" && result.error.tag !== "PathNotFoundError") {
      throw new Error(`read draft image failed with ${result.error.tag}`);
    }

    return Response.json({ error: "Photo not found" }, { status: 404 });
  }

  const candidates = target === "original"
    ? [
        { path: "/photos/original.png", contentType: "image/png" },
        { path: "/photos/original.jpg", contentType: "image/jpeg" },
      ]
    : [{ path: "/photos/current", contentType: undefined }];

  for (const candidate of candidates) {
    const result = await workspace.readFile(candidate.path);
    if (result.status === "ok") {
      return imageResponse(result.value, candidate.contentType ?? contentTypeForImage(result.value));
    }

    if (result.error.tag !== "PathNotFoundError") {
      throw new Error(`read ${candidate.path} failed with ${result.error.tag}`);
    }
  }

  return Response.json({ error: "Photo not found" }, { status: 404 });
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

function imageResponse(contents: Uint8Array, contentType: string): Response {
  return new Response(arrayBufferFor(contents), {
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
    },
  });
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
