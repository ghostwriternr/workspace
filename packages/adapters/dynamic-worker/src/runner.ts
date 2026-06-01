import { Result, type Result as BetterResult } from "better-result";
import type { WorkerEntrypoint } from "cloudflare:workers";
import type { ScopedWorkspaceFileCapability } from "@cloudflare/workspace";

export type WorkspaceDynamicWorkerResult = unknown;

export type WorkspaceDynamicWorkerExecutionError = {
  tag: "WorkspaceDynamicWorkerExecutionError";
  message: string;
};

export type WorkspaceDynamicWorkerFileCapability = Fetcher<WorkerEntrypoint<unknown, unknown> & ScopedWorkspaceFileCapability>;

export type WorkspaceDynamicWorkerRunOptions = {
  code: string;
  workspace: WorkspaceDynamicWorkerFileCapability;
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
  getEntrypoint(name?: string, options?: { props: { WORKSPACE: WorkspaceDynamicWorkerFileCapability } }): unknown;
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
    const env = { WORKSPACE: this.ctx.props.WORKSPACE };
    if (typeof worker === "function") {
      return await worker(env);
    }
    if (worker && typeof worker.run === "function") {
      return await worker.run(env);
    }
    throw new Error("Dynamic Worker module must default-export a function or { run(env) }.");
  }
}

`;

export function createWorkspaceDynamicWorkerRunner(
  loader: WorkspaceDynamicWorkerLoader,
  runnerOptions: WorkspaceDynamicWorkerRunnerOptions = {},
): WorkspaceDynamicWorkerRunner {
  return {
    async run(options) {
      try {
        const worker = loader.load({
          compatibilityDate: options.compatibilityDate ?? runnerOptions.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE,
          compatibilityFlags: options.compatibilityFlags ?? runnerOptions.compatibilityFlags ?? DEFAULT_COMPATIBILITY_FLAGS,
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
    },
  };
}
