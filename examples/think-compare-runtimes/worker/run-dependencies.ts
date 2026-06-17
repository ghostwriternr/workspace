import type { StartComparisonRunOptions } from "./runs";
import { createSandboxWarmPool } from "./sandbox-warm-pool";
import { createRawSandboxHostForLease, type RawSandboxFactory } from "./runtimes/raw-sandbox-host";
import { createRawSandboxRuntime } from "./runtimes/sandbox-runtime";

export interface ComparisonRunDependencyOptions {
  rawSandboxFactory: RawSandboxFactory;
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
