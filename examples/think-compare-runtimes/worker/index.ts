import { WorkspaceSandbox, WorkspaceContainerProxy } from "@cloudflare/workspace-adapter-sandbox/workers";

import { handleRequest } from "./http";

export { WorkspaceObject } from "@cloudflare/workspace/workers";
export { WorkspaceFileCapability } from "./workspace-file-capability";
export { WorkspaceContainerProxy as ContainerProxy };

export class Sandbox extends WorkspaceSandbox<Env> {}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
