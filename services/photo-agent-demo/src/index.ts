import { callable, routeAgentRequest } from "agents";
import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

import { createSandboxImageEditor } from "./image/cloudflare-sandbox";
import { handleDemoRequest } from "./http";
import { handlePhotoReadRequest } from "./photo-read-http";
import { handlePhotoStateRequest } from "./photo-state-http";
import { handlePhotoUploadRequest } from "./photo-upload-http";
import { PhotoDraftController, type PhotoState } from "./photo-draft-controller";

export { Sandbox } from "@cloudflare/sandbox";
export { WorkspaceObject } from "../../control-plane/src";

type PhotoAgentState = {
  draftEditId?: string;
  photo?: PhotoState;
};

const photoToolNames = [
  "listPhotoState",
  "runSandboxCommand",
  "saveDraftFromSandboxFile",
  "commitDraft",
  "discardDraft",
];

export class PhotoAgent extends Think<Env, PhotoAgentState> {
  initialState: PhotoAgentState = {};

  getModel() {
    return createWorkersAI({ binding: this.env.AI })("@cf/moonshotai/kimi-k2.6", {
      sessionAffinity: this.sessionAffinity,
    });
  }

  getSystemPrompt() {
    return [
      "You are a chat-first photo editing agent for the Workspace demo.",
      `The active Workspace is named ${this.name}.`,
      "Use Workspace as durable file state and Sandbox/ImageMagick only for image transformations.",
      "Upload is handled by the browser; after that, the user edits by chatting with you.",
      "Use draft edit language with the user: say \"draft edit\", \"make this current\", and \"throw away the draft\".",
      "Do not say session, commit session, or discard session to the user.",
      "You have broad freedom inside an isolated Sandbox working directory. Use shell commands, ImageMagick, identify, convert, and small scripts as needed.",
      "Use runSandboxCommand to inspect images and create files in the sandbox. Use saveDraftFromSandboxFile when you want a sandbox file to become the Workspace draft preview.",
      "The sandbox input file is named original.png, original.jpg, or current. ImageMagick is available as identify and convert in this container.",
      "Do not narrate every tool call. Briefly say what changed after the tool result is available.",
      "Only make a draft current when the user clearly asks to commit, approve, publish, or make it current.",
    ].join("\n");
  }

  beforeTurn() {
    return { activeTools: photoToolNames };
  }

  getTools(): ToolSet {
    return {
      listPhotoState: tool({
        description: "List passive photo state: uploaded original, current image, draft edit, and Workspace files.",
        inputSchema: z.object({}),
        execute: async () => this.refreshPhotoState(),
      }),
      runSandboxCommand: tool({
        description: [
          "Run any shell command inside the isolated photo sandbox working directory.",
          "Use this for image inspection and edits. Available tools include ImageMagick commands such as identify and convert.",
          "The current input image is hydrated as original.png, original.jpg, or current before the command runs.",
          "Commands can inspect images, create files, and run short scripts. Use saveDraftFromSandboxFile to import a generated image into the Workspace draft preview.",
          "Examples: `identify original.jpg`, `convert original.jpg -gravity center -crop 1024x1024+0+0 +repage square.png`, or short Python scripts.",
        ].join(" "),
        inputSchema: z.object({
          command: z.string().min(1).describe("Shell command to run inside the isolated sandbox working directory."),
        }),
        execute: async ({ command }) => this.controller().runSandboxCommand({ command }),
      }),
      saveDraftFromSandboxFile: tool({
        description: "Import a file from the sandbox working directory into the Workspace draft preview after a command creates the image you want to show.",
        inputSchema: z.object({
          filename: z.string().min(1).describe("Sandbox file name to import as the Workspace draft preview."),
        }),
        execute: async ({ filename }) => {
          const result = await this.controller().saveDraftFromSandboxFile({ filename });
          await this.refreshPhotoState();
          return result;
        },
      }),
      commitDraft: tool({
        description: "Make the draft edit current. Use only when the user asks to commit, approve, publish, or make it current.",
        inputSchema: z.object({}),
        execute: async () => {
          const result = await this.controller().commitDraft();
          await this.refreshPhotoState();
          return result;
        },
      }),
      discardDraft: tool({
        description: "Throw away the draft edit without changing the current image.",
        inputSchema: z.object({}),
        execute: async () => {
          const result = await this.controller().discardDraft();
          await this.refreshPhotoState();
          return result;
        },
      }),
    };
  }

  @callable()
  async photoState() {
    return this.refreshPhotoState();
  }

  @callable()
  async refreshPhotoState() {
    const photo = await this.controller().listPhotoState();
    this.setState({ ...this.state, photo });
    return photo;
  }

  @callable()
  async readDraftImage() {
    return this.controller().readDraftImage();
  }

  private controller(): PhotoDraftController {
    return new PhotoDraftController({
      workspaceName: this.name,
      workspaces: this.env.WORKSPACES,
      imageEditor: createSandboxImageEditor(this.env.Sandbox, this.name),
      getDraftEditId: () => this.state.draftEditId,
      setDraftEditId: (draftEditId) => this.setState({ ...this.state, draftEditId }),
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const uploadResponse = await handlePhotoUploadRequest(request, env.WORKSPACES, env.PhotoAgent);
    if (uploadResponse) {
      return uploadResponse;
    }

    const readResponse = await handlePhotoReadRequest(request, env.WORKSPACES, env.PhotoAgent);
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
