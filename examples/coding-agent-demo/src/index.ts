import { routeAgentRequest } from "agents";
import { Workspace } from "@cloudflare/workspace";
import { createGitHubSource } from "@cloudflare/workspace-source-github";

export { Sandbox } from "@cloudflare/sandbox";

import { handleDemoRequest } from "./http/demo";
import { handleRepoImportRequest } from "./http/repo-import";

export { WorkspaceObject } from "@cloudflare/workspace/workers";
export { CodingAgent } from "./agent/coding-agent";
export { WorkspaceFileCapability } from "./workspace/workspace-file-capability";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const importResponse = await handleRepoImportRequest(
      request,
      {
        github: createGitHubSource({ artifacts: env.ARTIFACTS }),
        workspaces: Workspace.bind({ artifacts: env.ARTIFACTS, objects: env.WORKSPACE_OBJECTS }),
      },
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
