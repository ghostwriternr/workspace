import { callable } from "agents";
import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

import { Workspace } from "@cloudflare/workspace";
import { createWorkspaceDynamicWorkerRunner } from "@cloudflare/workspace-adapter-dynamic-worker";
import { RepoWorkingCopyController } from "../repo/working-copy-controller";
import { createSandboxCommandRunner } from "../workspace/cloudflare-sandbox";
import { RepoStateController } from "../repo/state-controller";
import type { RepoImportSummary } from "../repo/import-controller";
import { buildSystemPrompt } from "./prompt";
import { resultToModelToolOutput } from "./tool-result";
import { CODING_TOOLS, CODING_TOOL_NAMES, codingToolDescription } from "./tools";

export type CodingAgentState = {
  lastImport?: RepoImportSummary;
  workingCopyId?: string;
};

export class CodingAgent extends Think<Env, CodingAgentState> {
  static readonly actions = ["listRepoState", "refreshRepoState", "applyWorkingCopy", "discardWorkingCopy", ...CODING_TOOL_NAMES] as const;

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
          offset: z.number().int().positive().optional().describe("Line number to start reading from, 1-indexed"),
          limit: z.number().int().positive().optional().describe("Maximum number of lines to read"),
        }),
        execute: async (input) => resultToModelToolOutput(await this.workingCopyController().read(input)),
      }),
      write: tool({
        description: codingToolDescription("write"),
        inputSchema: z.object({
          path: z.string().min(1).describe("Path to the file to write"),
          contents: z.string().describe("Content to write to the file"),
        }),
        execute: async (input) => resultToModelToolOutput(await this.workingCopyController().write(input)),
      }),
      edit: tool({
        description: codingToolDescription("edit"),
        inputSchema: z.object({
          path: z.string().min(1).describe("Path to the file to edit"),
          oldText: z.string().min(1).describe("Exact text to find and replace. Must be unique in the file."),
          newText: z.string().describe("Replacement text"),
        }),
        execute: async (input) => resultToModelToolOutput(await this.workingCopyController().edit(input)),
      }),
      run: tool({
        description: codingToolDescription("run"),
        inputSchema: z.object({
          code: z.string().min(1).describe("JavaScript module code. Must default-export an async function that takes env."),
        }),
        execute: async (input) => resultToModelToolOutput(await this.workingCopyController().run(input)),
      }),
      shell: tool({
        description: codingToolDescription("shell"),
        inputSchema: z.object({
          command: z.string().min(1).describe("Shell command to run with the working copy mounted at /workspace."),
        }),
        execute: async (input) => resultToModelToolOutput(await this.workingCopyController().shell(input)),
      }),
    };
  }

  @callable()
  async listRepoState() {
    return this.refreshRepoState();
  }

  @callable()
  async read(input: { path: string; offset?: number; limit?: number }) {
    return resultToRpc(await this.workingCopyController().read(input));
  }

  @callable()
  async write(input: { path: string; contents: string }) {
    return resultToRpc(await this.workingCopyController().write(input));
  }

  @callable()
  async edit(input: { path: string; oldText: string; newText: string }) {
    return resultToRpc(await this.workingCopyController().edit(input));
  }

  @callable()
  async run(input: { code: string }) {
    return resultToRpc(await this.workingCopyController().run(input));
  }

  @callable()
  async shell(input: { command: string }) {
    return resultToRpc(await this.workingCopyController().shell(input));
  }

  @callable()
  async applyWorkingCopy() {
    return resultToRpc(await this.workingCopyController().applyWorkingCopy());
  }

  @callable()
  async discardWorkingCopy() {
    return resultToRpc(await this.workingCopyController().discardWorkingCopy());
  }

  @callable()
  async refreshRepoState(lastImport?: RepoImportSummary) {
    const repo = await new RepoStateController({
      workspace: this.workspaceSurface(),
      workspaceName: this.name,
      workingCopyId: this.state.workingCopyId,
    }).listRepoState();

    if (lastImport) {
      this.setState({ ...this.state, lastImport });
    }
    return resultToRpc(repo);
  }

  private workingCopyController(): RepoWorkingCopyController {
    return new RepoWorkingCopyController({
      workspace: this.workspaceSurface(),
      workspaceName: this.name,
      dynamicWorkerRunner: createWorkspaceDynamicWorkerRunner(this.env.DYNAMIC_WORKERS),
      shellRunner: createSandboxCommandRunner(this.env.Sandbox, this.name),
      workspaceForWorkingCopy: (workingCopyId) => this.ctx.exports.WorkspaceFileCapability({ props: { workspaceName: this.name, workingCopyId } }),
      getWorkingCopyId: () => this.state.workingCopyId,
      setWorkingCopyId: (workingCopyId) => this.setState({ ...this.state, workingCopyId }),
    });
  }

  private workspaceSurface(): Workspace {
    return Workspace.bind({
      artifacts: this.env.ARTIFACTS,
      objects: this.env.WORKSPACE_OBJECTS,
    }).get(this.name);
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
