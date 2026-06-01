import { callable } from "agents";
import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";
import { RepoEditController } from "../repo/edit-controller";
import { RepoStateController } from "../repo/state-controller";
import type { RepoImportSummary } from "../repo/import-controller";
import { codingAgentPrompt } from "./prompt";
import { CODING_TOOL_NAMES } from "./tools";

export type CodingAgentState = {
  lastImport?: RepoImportSummary;
  editCopyId?: string;
};

export class CodingAgent extends Think<Env, CodingAgentState> {
  static readonly actions = ["listRepoState", "refreshRepoState", "applyEdit", "discardEdit", ...CODING_TOOL_NAMES] as const;

  initialState: CodingAgentState = {};
  override workspace = disabledThinkWorkspace;

  getModel() {
    return createWorkersAI({ binding: this.env.AI })("@cf/moonshotai/kimi-k2.6", {
      sessionAffinity: this.sessionAffinity,
    });
  }

  getSystemPrompt() {
    return codingAgentPrompt(this.name);
  }

  beforeTurn() {
    return { activeTools: [...CODING_TOOL_NAMES] };
  }

  getTools(): ToolSet {
    return {
      read: tool({
        description: "Read a text file or list a directory from the current repo state or active edit copy.",
        inputSchema: z.object({ path: z.string().min(1) }),
        execute: async (input) => this.read(input),
      }),
      write: tool({
        description: "Write a text file in the active edit copy, creating parent directories as needed.",
        inputSchema: z.object({
          path: z.string().min(1),
          contents: z.string(),
        }),
        execute: async (input) => this.write(input),
      }),
      edit: tool({
        description: "Replace one exact text occurrence in a file in the active edit copy. Fails when the match is missing or ambiguous.",
        inputSchema: z.object({
          path: z.string().min(1),
          oldText: z.string().min(1),
          newText: z.string(),
        }),
        execute: async (input) => this.edit(input),
      }),
      run: tool({
        description: [
          "Run Worker-native JavaScript against the active edit copy through env.WORKSPACE.",
          "Use this for repo inspection or edits that are easier to express in code.",
          "The module must default-export an async function that accepts env.",
        ].join(" "),
        inputSchema: z.object({ code: z.string().min(1) }),
        execute: async (input) => this.run(input),
      }),
    };
  }

  @callable()
  async listRepoState() {
    return this.refreshRepoState();
  }

  @callable()
  async read(input: { path: string }) {
    return resultToRpc(await this.editController().read(input));
  }

  @callable()
  async write(input: { path: string; contents: string }) {
    return resultToRpc(await this.editController().write(input));
  }

  @callable()
  async edit(input: { path: string; oldText: string; newText: string }) {
    return resultToRpc(await this.editController().edit(input));
  }

  @callable()
  async run(input: { code: string }) {
    return resultToRpc(await this.editController().run(input));
  }

  @callable()
  async applyEdit() {
    return resultToRpc(await this.editController().applyEdit());
  }

  @callable()
  async discardEdit() {
    return resultToRpc(await this.editController().discardEdit());
  }

  @callable()
  async refreshRepoState(lastImport?: RepoImportSummary) {
    const repo = await new RepoStateController({
      workspaces: this.env.WORKSPACES,
      workspaceName: this.name,
      editCopyId: this.state.editCopyId,
    }).listRepoState();

    if (lastImport) {
      this.setState({ ...this.state, lastImport });
    }
    return resultToRpc(repo);
  }

  private editController(): RepoEditController {
    return new RepoEditController({
      workspaces: this.env.WORKSPACES,
      workspaceName: this.name,
      dynamicWorkerRunner: createWorkspaceDynamicWorkerRunner(this.env.DYNAMIC_WORKERS),
      workspaceForEdit: (editCopyId) => this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName: this.name, editCopyId } }),
      getEditCopyId: () => this.state.editCopyId,
      setEditCopyId: (editCopyId) => this.setState({ ...this.state, editCopyId }),
    });
  }
}

function resultToRpc<T, E>(result: { status: "ok"; value: T } | { status: "error"; error: E }): { status: "ok"; value: T } | { status: "error"; error: E } {
  if (result.status === "error") {
    return { status: "error", error: result.error };
  }
  return { status: "ok", value: result.value };
}

const disabledThinkWorkspace = {
  async readFile(): Promise<never> { return disabledWorkspaceMethod(); },
  async readFileBytes(): Promise<never> { return disabledWorkspaceMethod(); },
  async writeFile(): Promise<never> { return disabledWorkspaceMethod(); },
  async readDir(): Promise<never> { return disabledWorkspaceMethod(); },
  async rm(): Promise<never> { return disabledWorkspaceMethod(); },
  async glob(): Promise<never> { return disabledWorkspaceMethod(); },
  async mkdir(): Promise<never> { return disabledWorkspaceMethod(); },
  async stat(): Promise<never> { return disabledWorkspaceMethod(); },
};

function disabledWorkspaceMethod(): never {
  throw new Error("Use @cloudflare/workspace-backed coding tools for repository files.");
}
