import { callable } from "agents";
import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

import { RepoEditController } from "../repo/edit-controller";
import { RepoStateController } from "../repo/state-controller";
import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";
import type { RepoImportSummary } from "../repo/import-controller";
import { codingAgentPrompt } from "./prompt";
import { CODING_TOOL_NAMES } from "./tools";

export type CodingAgentState = {
  lastImport?: RepoImportSummary;
  editCopyId?: string;
};

export class CodingAgent extends Think<Env, CodingAgentState> {
  static readonly actions = ["listRepoState", "refreshRepoState", ...CODING_TOOL_NAMES] as const;

  initialState: CodingAgentState = {};

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
      runWorkspaceWorker: tool({
        description: [
          "Run Worker-native JavaScript against Workspace files through a scoped env.WORKSPACE binding.",
          "Use this single tool for inspection and edits. The binding exposes readFile, writeFile, list, and stat.",
          "Workspace file methods return plain objects with status ok/error; check status before using values.",
          "The code must default-export an async function that accepts env.",
          "Example: `export default async function(env) { const read = await env.WORKSPACE.readFile('/README.md'); if (read.status === 'error') return read; const text = new TextDecoder().decode(read.value); const write = await env.WORKSPACE.writeFile('/README.md', new TextEncoder().encode(text + '\\n\\n## Notes\\nUpdated by the coding agent.\\n')); if (write.status === 'error') return write; return { changed: ['/README.md'] }; }`",
        ].join(" "),
        inputSchema: z.object({
          code: z.string().min(1).describe("ES module code for the Workspace Worker."),
        }),
        execute: async ({ code }) => this.runWorkspaceWorker({ code }),
      }),
      applyEdit: tool({
        description: "Apply the active edit copy to current Workspace files. Use only when the user asks to apply, accept, publish, or make the edit current.",
        inputSchema: z.object({}),
        execute: async () => this.applyEdit(),
      }),
      discardEdit: tool({
        description: "Discard the active edit copy without changing current Workspace files.",
        inputSchema: z.object({}),
        execute: async () => this.discardEdit(),
      }),
    };
  }

  @callable()
  async listRepoState() {
    return this.refreshRepoState();
  }

  @callable()
  async runWorkspaceWorker({ code }: { code: string }) {
    const result = await this.editController().runWorkspaceWorker({ code });

    return resultToRpc(result);
  }

  @callable()
  async applyEdit() {
    const result = await this.editController().applyEdit();

    return resultToRpc(result);
  }

  @callable()
  async discardEdit() {
    const result = await this.editController().discardEdit();

    return resultToRpc(result);
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
