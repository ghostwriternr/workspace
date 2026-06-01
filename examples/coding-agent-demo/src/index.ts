import { routeAgentRequest } from "agents";

import { handleDemoRequest } from "./http/demo";
import { handleRepoImportRequest } from "./http/repo-import";

export { WorkspaceObject } from "@cloudflare/workspace";
export { CodingAgent } from "./agent/coding-agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const importResponse = await handleRepoImportRequest(request, env.WORKSPACES, env.CodingAgent);
    if (importResponse) {
      return importResponse;
    }

    const demoResponse = handleDemoRequest(request);
    if (demoResponse) {
      return demoResponse;
    }

    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
