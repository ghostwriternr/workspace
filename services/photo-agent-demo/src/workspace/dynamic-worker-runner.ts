import type { ScopedWorkspaceFileCapability } from "../../../control-plane/src/workspace/scoped-file-capability";

export type DynamicWorkerResult = unknown;
export type DynamicWorkerWorkspaceBinding = Pick<ScopedWorkspaceFileCapability, "readFile" | "writeFile" | "list" | "stat">;

export interface DemoDynamicWorkerRunner {
  runDynamicWorker(options: {
    workspace: DynamicWorkerWorkspaceBinding;
    code: string;
  }): Promise<DynamicWorkerResult>;
}

type DynamicWorkerEntrypoint = {
  run(): Promise<DynamicWorkerResult>;
};

type DynamicWorkerStub = {
  getEntrypoint(name?: string, options?: { props: { WORKSPACE: DynamicWorkerWorkspaceBinding } }): unknown;
};

type DynamicWorkerLoader = {
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

const HARNESS = `
import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "worker.js";

export default class extends WorkerEntrypoint {
  async run() {
    const env = { ...this.env, WORKSPACE: this.ctx.props.WORKSPACE };
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

export class DynamicWorkerRunner implements DemoDynamicWorkerRunner {
  constructor(private readonly loader: DynamicWorkerLoader) {}

  async runDynamicWorker(options: Parameters<DemoDynamicWorkerRunner["runDynamicWorker"]>[0]) {
    const worker = this.loader.load({
      compatibilityDate: "2026-05-25",
      compatibilityFlags: ["nodejs_compat", "disallow_importable_env", "experimental"],
      allowExperimental: true,
      mainModule: "harness.js",
      modules: {
        "harness.js": HARNESS,
        "worker.js": options.code,
      },
      globalOutbound: null,
    });

    const entrypoint = worker.getEntrypoint(undefined, { props: { WORKSPACE: options.workspace } });
    if (!isDynamicWorkerEntrypoint(entrypoint)) {
      throw new Error("Dynamic Worker entrypoint does not expose run().");
    }

    return entrypoint.run();
  }
}

export function createDynamicWorkerRunner(loader: DynamicWorkerLoader): DemoDynamicWorkerRunner {
  return new DynamicWorkerRunner(loader);
}

function isDynamicWorkerEntrypoint(value: unknown): value is DynamicWorkerEntrypoint {
  return typeof value === "object" && value !== null && "run" in value && typeof value.run === "function";
}
