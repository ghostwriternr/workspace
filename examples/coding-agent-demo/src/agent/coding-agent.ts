import { callable } from "agents";
import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";
import { RepoEditController } from "../repo/edit-controller";
import { RepoStateController } from "../repo/state-controller";
import type { RepoImportSummary } from "../repo/import-controller";
import { buildSystemPrompt } from "./prompt";
import { resultToModelToolOutput } from "./tool-result";
import { CODING_TOOLS, CODING_TOOL_NAMES, codingToolDescription } from "./tools";

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
    return buildSystemPrompt(this.name, CODING_TOOLS);
  }

  beforeTurn() {
    return { activeTools: [...CODING_TOOL_NAMES] };
  }

  getTools(): ToolSet {
    return {
      read: tool({
        description: codingToolDescription("read"),
        inputSchema: z.object({
          path: z.string().min(1).describe("Path to the file or directory to read"),
        }),
        execute: async (input) => resultToModelToolOutput(await this.editController().read(input)),
      }),
      write: tool({
        description: codingToolDescription("write"),
        inputSchema: z.object({
          path: z.string().min(1).describe("Path to the file to write"),
          contents: z.string().describe("Content to write to the file"),
        }),
        execute: async (input) => resultToModelToolOutput(await this.editController().write(input)),
      }),
      edit: tool({
        description: codingToolDescription("edit"),
        inputSchema: z.object({
          path: z.string().min(1).describe("Path to the file to edit"),
          oldText: z.string().min(1).describe("Exact text to find and replace. Must be unique in the file."),
          newText: z.string().describe("Replacement text"),
        }),
        execute: async (input) => resultToModelToolOutput(await this.editController().edit(input)),
      }),
      run: tool({
        description: codingToolDescription("run"),
        inputSchema: z.object({
          code: z.string().min(1).describe("JavaScript module code. Must default-export an async function that takes env."),
        }),
        execute: async (input) => resultToModelToolOutput(await this.editController().run(input)),
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
