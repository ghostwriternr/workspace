import type { DynamicWorkerWorkspaceBinding, DynamicWorkerWorkspaceBindingFactory } from "./workspace-file-capability";

export type DynamicWorkerResult = unknown;

export interface DemoDynamicWorkerRunner {
  runDynamicWorker(options: {
    editCopyId: string;
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

export class DynamicWorkerRunner implements DemoDynamicWorkerRunner {
  constructor(
    private readonly loader: DynamicWorkerLoader,
    private readonly workspaceBindings: DynamicWorkerWorkspaceBindingFactory,
  ) {}

  async runDynamicWorker(options: Parameters<DemoDynamicWorkerRunner["runDynamicWorker"]>[0]) {
    const worker = this.loader.load({
      compatibilityDate: "2026-05-26",
      compatibilityFlags: ["nodejs_compat", "disallow_importable_env", "experimental"],
      allowExperimental: true,
      mainModule: "harness.js",
      modules: {
        "harness.js": HARNESS,
        "worker.js": options.code,
      },
      globalOutbound: null,
    });

    const workspace = this.workspaceBindings.bindingForEdit(options.editCopyId);
    const entrypoint = worker.getEntrypoint(undefined, { props: { WORKSPACE: workspace } }) as DynamicWorkerEntrypoint;
    return entrypoint.run();
  }
}

export function createDynamicWorkerRunner(
  loader: DynamicWorkerLoader,
  workspaceBindings: DynamicWorkerWorkspaceBindingFactory,
): DemoDynamicWorkerRunner {
  return new DynamicWorkerRunner(loader, workspaceBindings);
}
