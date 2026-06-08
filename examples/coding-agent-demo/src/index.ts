import { routeAgentRequest } from "agents";

export { Sandbox } from "@cloudflare/sandbox";

import { handleDemoRequest } from "./http/demo";
import { handleRepoImportRequest } from "./http/repo-import";

export { CodingAgent } from "./agent/coding-agent";
export { WorkspaceFileCapability } from "./workspace/workspace-file-capability";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const importResponse = await handleRepoImportRequest(
      request,
      { artifacts: env.ARTIFACTS },
      { agents: env.CodingAgent },
    );
    if (importResponse) {
      return importResponse;
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    return handleDemoRequest(request) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
