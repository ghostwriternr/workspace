import { Result, type Result as BetterResult } from "better-result";
import type { ScopedWorkspaceFileCapability } from "@cloudflare/workspace";

export type WorkspaceDynamicWorkerResult = unknown;

export type WorkspaceDynamicWorkerExecutionError = {
  tag: "WorkspaceDynamicWorkerExecutionError";
  message: string;
};

export type WorkspaceDynamicWorkerRunOptions = {
  code: string;
  workspace: ScopedWorkspaceFileCapability;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
};

export type WorkspaceDynamicWorkerRunner = {
  run(options: WorkspaceDynamicWorkerRunOptions): Promise<BetterResult<WorkspaceDynamicWorkerResult, WorkspaceDynamicWorkerExecutionError>>;
};

type DynamicWorkerEntrypoint = {
  run(): Promise<WorkspaceDynamicWorkerResult>;
};

type DynamicWorkerStub = {
  getEntrypoint(name?: string, options?: { props: { WORKSPACE: ScopedWorkspaceFileCapability } }): unknown;
};

export type WorkspaceDynamicWorkerLoader = {
  load(code: {
    compatibilityDate: string;
    compatibilityFlags?: string[];
    allowExperimental?: boolean;
    mainModule: string;
    modules: Record<string, string>;
    env?: Record<string, unknown>;
    globalOutbound?: null;
  }): DynamicWorkerStub;
};

export type WorkspaceDynamicWorkerRunnerOptions = {
  compatibilityDate?: string;
  compatibilityFlags?: string[];
};

const DEFAULT_COMPATIBILITY_DATE = "2026-05-26";
const DEFAULT_COMPATIBILITY_FLAGS = ["nodejs_compat", "disallow_importable_env", "experimental"];

const HARNESS = `
import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "worker.js";

export default class extends WorkerEntrypoint {
  async run() {
    const env = { WORKSPACE: workspaceForUserCode(this.ctx.props.WORKSPACE) };
    if (typeof worker === "function") {
      return await worker(env);
    }
    if (worker && typeof worker.run === "function") {
      return await worker.run(env);
    }
    throw new Error("Dynamic Worker module must default-export a function or { run(env) }.");
  }
}

function workspaceForUserCode(workspace) {
  return {
    readFile: async (path) => unwrapWorkspaceResult(await workspace.readFile(path)),
    writeFile: async (path, contents) => unwrapWorkspaceResult(await workspace.writeFile(path, contents)),
    list: async (path) => unwrapWorkspaceResult(await workspace.list(path)),
    stat: async (path) => unwrapWorkspaceResult(await workspace.stat(path)),
  };
}

function unwrapWorkspaceResult(result) {
  if (result.status === "error") {
    throw new Error(result.error.message || result.error.tag);
  }
  return result.value;
}
`;

export function createWorkspaceDynamicWorkerRunner(
  loader: WorkspaceDynamicWorkerLoader,
  options: WorkspaceDynamicWorkerRunnerOptions = {},
): WorkspaceDynamicWorkerRunner {
  return new DefaultWorkspaceDynamicWorkerRunner(loader, options);
}

class DefaultWorkspaceDynamicWorkerRunner implements WorkspaceDynamicWorkerRunner {
  constructor(
    private readonly loader: WorkspaceDynamicWorkerLoader,
    private readonly options: WorkspaceDynamicWorkerRunnerOptions,
  ) {}

  async run(options: WorkspaceDynamicWorkerRunOptions): Promise<BetterResult<WorkspaceDynamicWorkerResult, WorkspaceDynamicWorkerExecutionError>> {
    try {
      const worker = this.loader.load({
        compatibilityDate: options.compatibilityDate ?? this.options.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE,
        compatibilityFlags: options.compatibilityFlags ?? this.options.compatibilityFlags ?? DEFAULT_COMPATIBILITY_FLAGS,
        allowExperimental: true,
        mainModule: "harness.js",
        modules: {
          "harness.js": HARNESS,
          "worker.js": options.code,
        },
        globalOutbound: null,
      });

      const entrypoint = worker.getEntrypoint(undefined, { props: { WORKSPACE: options.workspace } }) as DynamicWorkerEntrypoint;
      return Result.ok(await entrypoint.run());
    } catch (error) {
      return Result.err({
        tag: "WorkspaceDynamicWorkerExecutionError",
        message: error instanceof Error ? error.message : "Dynamic Worker execution failed.",
      });
    }
  }
}
