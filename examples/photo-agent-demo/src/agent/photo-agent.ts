import { callable } from "agents";
import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

import { createSandboxWorkspaceCommandRunner } from "../workspace/cloudflare-sandbox";
import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";
import { PhotoDraftController, type PhotoState } from "../photo/draft-controller";
import { photoAgentPrompt } from "./prompt";

type PhotoAgentState = {
  draftEditId?: string;
  photo?: PhotoState;
};

const photoToolNames = [
  "listPhotoState",
  "runWorkspaceCommand",
  "runDynamicWorker",
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
    return photoAgentPrompt(this.name);
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
      runWorkspaceCommand: tool({
        description: [
          "Run any shell command inside the isolated Sandbox with the active draft mounted at /workspace.",
          "Use this for image inspection and edits. Available tools include ImageMagick commands such as identify and convert.",
          "Files written under /workspace become part of the draft preview after the command exits, even if the command fails.",
          "Examples: `identify /workspace/photos/original.jpg`, `convert /workspace/photos/original.jpg -gravity center -crop 1024x1024+0+0 +repage /workspace/photos/current`, or short Python scripts that read and write /workspace files.",
        ].join(" "),
        inputSchema: z.object({
          command: z.string().min(1).describe("Shell command to run with the draft mounted at /workspace."),
        }),
        execute: async ({ command }) => {
          const result = await this.controller().runWorkspaceCommand({ command });
          await this.refreshPhotoState();
          return result;
        },
      }),
      runDynamicWorker: tool({
        description: [
          "Run Worker-native JavaScript against the active draft edit through a scoped env.WORKSPACE binding.",
          "Use this for metadata, notes, manifests, and file-oriented JavaScript tasks over Workspace files.",
          "The code must default-export an async function that accepts env. The binding exposes readFile, writeFile, list, and stat only.",
          "Workspace file methods return plain objects with status ok/error; check status before using values.",
          "Example: `export default async function(env) { const write = await env.WORKSPACE.writeFile('/notes/edit-summary.md', new TextEncoder().encode('Cropped to a centered square.')); if (write.status === 'error') return write; return { wrote: '/notes/edit-summary.md' }; }`",
        ].join(" "),
        inputSchema: z.object({
          code: z.string().min(1).describe("ES module code for the Dynamic Worker."),
        }),
        execute: async ({ code }) => {
          const result = await this.controller().runDynamicWorker({ code });
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
      commandRunner: createSandboxWorkspaceCommandRunner(this.env.Sandbox, this.name),
      dynamicWorkerRunner: createWorkspaceDynamicWorkerRunner(this.env.DYNAMIC_WORKERS),
      workspaceForDraft: (draftEditId) =>
        this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName: this.name, draftEditId } }),
      getDraftEditId: () => this.state.draftEditId,
      setDraftEditId: (draftEditId) => this.setState({ ...this.state, draftEditId }),
    });
  }
}
