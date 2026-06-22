import type { RunEventInput, StartComparisonRunOptions } from "../runs";
import { createDurableSandboxWarmPool, type SandboxWarmPoolNamespace } from "../sandbox-warm-pool";
import { createThinkRuntimeTurnOptions } from "../think/runtime-turn-options";
import { createRawSandboxHostForLease, type RawSandboxFactory } from "./raw-sandbox-host";
import { createRawSandboxRuntime } from "./raw-sandbox-runtime";

interface RuntimeAgentNamespace {
  getByName(name: string): {
    runComparison(input: { runId: string; leaseId: string }): Promise<RunEventInput[]>;
  };
}

export interface ComparisonRunDependencyOptions {
  rawSandboxFactory: RawSandboxFactory;
}

export interface LiveComparisonRunDependencyOptions {
  workspaceRuntimeAgent: RuntimeAgentNamespace;
  sandboxRuntimeAgent: RuntimeAgentNamespace;
  workspaceSandboxWarmPool: SandboxWarmPoolNamespace;
  rawSandboxWarmPool: SandboxWarmPoolNamespace;
  createId?: () => string;
}

export function createComparisonRunOptions(
  options: ComparisonRunDependencyOptions,
): Pick<StartComparisonRunOptions, "createSandboxRuntime" | "rawSandboxPool"> {
  return {
    rawSandboxPool: createStaticSandboxPool("raw-sandbox", 2),
    createSandboxRuntime: (lease) =>
      createRawSandboxRuntime(createRawSandboxHostForLease(options.rawSandboxFactory, lease)),
  };
}

export function createLiveComparisonRunOptions({
  workspaceRuntimeAgent,
  sandboxRuntimeAgent,
  workspaceSandboxWarmPool,
  rawSandboxWarmPool,
  createId = () => crypto.randomUUID(),
}: LiveComparisonRunDependencyOptions): StartComparisonRunOptions {
  const id = createId();
  return {
    workspaceSandboxPool: createDurableSandboxWarmPool(workspaceSandboxWarmPool, `${id}:workspace`),
    rawSandboxPool: createDurableSandboxWarmPool(rawSandboxWarmPool, `${id}:sandbox`),
    ...createThinkRuntimeTurnOptions({ workspaceRuntimeAgent, sandboxRuntimeAgent }),
  };
}

function createStaticSandboxPool(prefix: string, size: number): NonNullable<StartComparisonRunOptions["rawSandboxPool"]> {
  const available = Array.from({ length: size }, (_, index) => `${prefix}-${index}`);
  const leased = new Set<string>();

  return {
    async lease() {
      const id = available.shift();
      if (!id) throw new Error(`No warm sandboxes available for ${prefix}`);
      leased.add(id);
      return { id };
    },
    async release(lease) {
      if (!leased.delete(lease.id)) return;
      available.unshift(lease.id);
    },
  };
}
