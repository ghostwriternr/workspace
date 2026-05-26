import { WorkerEntrypoint } from "cloudflare:workers";
import { callable, routeAgentRequest } from "agents";
import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

import { createWorkspaceFileCapability } from "../../control-plane/src/workspace/scoped-file-capability";
import { createSandboxWorkspaceCommandRunner } from "./workspace/cloudflare-sandbox";
import { createDynamicWorkerRunner } from "./workspace/dynamic-worker-runner";
import { handleDemoRequest } from "./http";
import { handlePhotoReadRequest } from "./photo-read-http";
import { handlePhotoStateRequest } from "./photo-state-http";
import { handlePhotoUploadRequest } from "./photo-upload-http";
import { PhotoDraftController, type PhotoState } from "./photo-draft-controller";

export { Sandbox } from "@cloudflare/sandbox";
export { WorkspaceObject } from "../../control-plane/src";

type WorkspaceFileCapabilityProps = {
  workspaceName: string;
  draftEditId: string;
};

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

export class WorkspaceFileCapability extends WorkerEntrypoint<Env, WorkspaceFileCapabilityProps> {
  async readFile(path: string): Promise<Uint8Array> {
    return this.withCapability((workspace) => workspace.readFile(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    return this.withCapability((workspace) => workspace.writeFile(path, contents));
  }

  async list(path: string) {
    return this.withCapability((workspace) => workspace.list(path));
  }

  async stat(path: string) {
    return this.withCapability((workspace) => workspace.stat(path));
  }

  private async withCapability<T>(useCapability: (workspace: ReturnType<typeof createWorkspaceFileCapability>) => Promise<T>): Promise<T> {
    const workspace = this.env.WORKSPACES.getByName(this.ctx.props.workspaceName);
    const sessionResult = await workspace.getSession(this.ctx.props.draftEditId);
    try {
      if (sessionResult.status === "error") {
        throw new Error(`draft edit not found: ${sessionResult.error.tag}`);
      }

      const capability = createWorkspaceFileCapability({
        workingCopy: sessionResult.value!,
        root: "/",
        read: ["/photos/**"],
        write: ["/photos/**", "/notes/**"],
        delete: false,
      });
      return await useCapability(capability);
    } finally {
      disposeRpc(sessionResult);
    }
  }
}

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
      "Use Workspace as durable file state, Sandbox/ImageMagick for image transformations, and Dynamic Workers for Worker-native JavaScript tasks over draft files.",
      "Upload is handled by the browser; after that, the user edits by chatting with you.",
      "Use draft edit language with the user: say \"draft edit\", \"make this current\", and \"throw away the draft\".",
      "Do not say session, commit session, or discard session to the user.",
      "You have broad freedom inside an isolated Sandbox with the draft edit mounted at /workspace.",
      "Use runWorkspaceCommand to inspect and edit files under /workspace. Successful commands flush /workspace changes into the Workspace draft preview.",
      "Use paths like /workspace/photos/original.png, /workspace/photos/original.jpg, and /workspace/photos/current. ImageMagick is available as identify and convert in this container.",
      "Use runDynamicWorker for Worker-native JavaScript tasks over the same draft edit. Delegated code receives env.WORKSPACE with readFile, writeFile, list, and stat only.",
      "For notes or metadata, write files such as /notes/edit-summary.md or /photos/edit-summary.json through env.WORKSPACE.writeFile.",
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
      runWorkspaceCommand: tool({
        description: [
          "Run any shell command inside the isolated Sandbox with the active draft mounted at /workspace.",
          "Use this for image inspection and edits. Available tools include ImageMagick commands such as identify and convert.",
          "Files written under /workspace become part of the draft preview after the command succeeds.",
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
          "Example: `export default async function(env) { await env.WORKSPACE.writeFile('/notes/edit-summary.md', new TextEncoder().encode('Cropped to a centered square.')); return { wrote: '/notes/edit-summary.md' }; }`",
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
      dynamicWorkerRunner: createDynamicWorkerRunner(this.env.DYNAMIC_WORKERS),
      dynamicWorkspaceBinding: (draftEditId) =>
        this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName: this.name, draftEditId } }),
      getDraftEditId: () => this.state.draftEditId,
      setDraftEditId: (draftEditId) => this.setState({ ...this.state, draftEditId }),
    });
  }
}

function disposeRpc(value: unknown): void {
  if (value && typeof value === "object" && Symbol.dispose in value) {
    const disposable = value as { [Symbol.dispose]: () => void };
    disposable[Symbol.dispose]();
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
