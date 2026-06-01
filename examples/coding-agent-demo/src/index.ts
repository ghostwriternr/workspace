import { handleDemoRequest } from "./http/demo";
import { handleRepoImportRequest } from "./http/repo-import";

export { WorkspaceObject } from "@cloudflare/workspace";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const importResponse = await handleRepoImportRequest(request, env.WORKSPACES);
    if (importResponse) {
      return importResponse;
    }

    return handleDemoRequest(request) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
