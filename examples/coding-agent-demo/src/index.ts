import { routeAgentRequest } from "agents";

import { handleDemoRequest } from "./http/demo";
import { handleRepoImportRequest } from "./http/repo-import";

export { WorkspaceObject } from "@cloudflare/workspace";
export { CodingAgent } from "./agent/coding-agent";
export { WorkspaceFileCapability } from "./workspace/workspace-file-capability";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const importResponse = await handleRepoImportRequest(
      request,
      { workspaces: env.WORKSPACES, githubToken: optionalGithubToken(env) },
      env.CodingAgent,
    );
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

function optionalGithubToken(env: Env): string | undefined {
  const token = (env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
  return token && token.length > 0 ? token : undefined;
}
