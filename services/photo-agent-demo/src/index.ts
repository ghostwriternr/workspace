import { callable, routeAgentRequest } from "agents";
import { Think } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";

import { runDemoScenario as runWorkspaceDemoScenario } from "./demo-scenario";
import { createSandboxImageEditor } from "./image/cloudflare-sandbox";
import { handleDemoRequest } from "./http";
import { handlePhotoEditRequest } from "./photo-edit-http";
import { handlePhotoReadRequest } from "./photo-read-http";
import { handlePhotoUploadRequest } from "./photo-upload-http";

export { Sandbox } from "@cloudflare/sandbox";
export { WorkspaceObject } from "../../control-plane/src";

export class PhotoAgent extends Think<Env> {
  getModel() {
    return createWorkersAI({ binding: this.env.AI })("@cf/moonshotai/kimi-k2.6");
  }

  getSystemPrompt() {
    return [
      "You are a photo editing agent for the Workspace demo.",
      "Use Workspace as durable file state and Sandbox/ImageMagick only for image transformations.",
      "Keep draft edits uncommitted until the user asks to make them current.",
    ].join("\n");
  }

  @callable()
  async runDemoScenario(workspaceName?: string) {
    const name = workspaceName ?? `photo-demo-${crypto.randomUUID()}`;
    return runWorkspaceDemoScenario({
      workspaces: this.env.WORKSPACES,
      imageEditor: createSandboxImageEditor(this.env.Sandbox, name),
      workspaceName: name,
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const uploadResponse = await handlePhotoUploadRequest(request, env.WORKSPACES);
    if (uploadResponse) {
      return uploadResponse;
    }

    const readResponse = await handlePhotoReadRequest(request, env.WORKSPACES);
    if (readResponse) {
      return readResponse;
    }

    const editResponse = await handlePhotoEditRequest(request, {
      workspaces: env.WORKSPACES,
      createImageEditor: (workspaceName) => createSandboxImageEditor(env.Sandbox, workspaceName),
    });
    if (editResponse) {
      return editResponse;
    }

    const demoResponse = handleDemoRequest(request);
    if (demoResponse) {
      return demoResponse;
    }

    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
