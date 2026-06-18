import type { RunEventInput, StartComparisonRunOptions } from "./runs";
import { createSandboxWarmPool } from "./sandbox-warm-pool";
import { createThinkRuntimeTurnOptions } from "./think/runtime-turn-options";
import { createRawSandboxHostForLease, type RawSandboxFactory } from "./runtimes/raw-sandbox-host";
import { createRawSandboxRuntime } from "./runtimes/sandbox-runtime";

interface RuntimeAgentNamespace {
  getByName(name: string): {
    runComparison(input: { runId: string; leaseId: string }): Promise<RunEventInput[]>;
  };
}

export interface ComparisonRunDependencyOptions {
  rawSandboxFactory: RawSandboxFactory;
}

export interface LiveComparisonRunDependencyOptions extends ComparisonRunDependencyOptions {
  workspaceRunOptions: Pick<StartComparisonRunOptions, "createWorkspaceRuntime" | "workspaceSandboxPool">;
  workspaceRuntimeAgent: RuntimeAgentNamespace;
  sandboxRuntimeAgent: RuntimeAgentNamespace;
  createId?: () => string;
}

export function createComparisonRunOptions(
  options: ComparisonRunDependencyOptions,
): Pick<StartComparisonRunOptions, "createSandboxRuntime" | "rawSandboxPool"> {
  return {
    rawSandboxPool: createSandboxWarmPool({ prefix: "raw-sandbox", size: 2 }),
    createSandboxRuntime: (lease) =>
      createRawSandboxRuntime(createRawSandboxHostForLease(options.rawSandboxFactory, lease)),
  };
}

export function createLiveComparisonRunOptions({
  workspaceRunOptions,
  workspaceRuntimeAgent,
  sandboxRuntimeAgent,
  rawSandboxFactory,
  createId = () => crypto.randomUUID(),
}: LiveComparisonRunDependencyOptions): StartComparisonRunOptions {
  const id = createId();
  return {
    ...createComparisonRunOptions({ rawSandboxFactory }),
    ...workspaceRunOptions,
    workspaceSandboxPool: createSandboxWarmPool({ prefix: `workspace-sandbox-${id}`, size: 2 }),
    rawSandboxPool: createSandboxWarmPool({ prefix: `raw-sandbox-${id}`, size: 2 }),
    ...createThinkRuntimeTurnOptions({ workspaceRuntimeAgent, sandboxRuntimeAgent }),
  };
}
