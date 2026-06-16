import { routeAgentRequest } from "agents";
import { WorkspaceSandbox, WorkspaceContainerProxy } from "@cloudflare/workspace-adapter-sandbox/workers";

import { handleDemoRequest } from "./http/demo";
import { handlePhotoReadRequest } from "./http/photo-read";
import { handlePhotoStateRequest } from "./http/photo-state";
import { handlePhotoUploadRequest } from "./http/photo-upload";

export { WorkspaceContainerProxy as ContainerProxy };
export { WorkspaceObject } from "@cloudflare/workspace/workers";
export { PhotoAgent } from "./agent/photo-agent";
// Dynamic Worker Loader can receive reconstructable loopback stubs through props.
// The example keeps that transport boundary explicit and outside the photo controller.
export { WorkspaceFileCapability } from "./workspace/workspace-file-capability";

export class Sandbox extends WorkspaceSandbox<Env> {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const uploadResponse = await handlePhotoUploadRequest(request, env.ARTIFACTS, env.WORKSPACE_OBJECTS, env.PhotoAgent);
    if (uploadResponse) {
      return uploadResponse;
    }

    const readResponse = await handlePhotoReadRequest(request, env.ARTIFACTS, env.WORKSPACE_OBJECTS, env.PhotoAgent);
    if (readResponse) {
      return readResponse;
    }

    const stateResponse = await handlePhotoStateRequest(request, env.PhotoAgent);
    if (stateResponse) {
      return stateResponse;
    }

    const demoResponse = handleDemoRequest(request);
    if (demoResponse) {
      return demoResponse;
    }

    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
