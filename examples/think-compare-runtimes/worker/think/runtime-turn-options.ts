import type { RunEventInput, StartComparisonRunOptions } from "../runs";

interface RuntimeAgentHandle {
  runComparison(input: { runId: string; leaseId: string }): Promise<RunEventInput[]>;
}

interface RuntimeAgentNamespace {
  getByName(name: string): RuntimeAgentHandle;
}

interface ThinkRuntimeTurnOptionsInput {
  workspaceRuntimeAgent: RuntimeAgentNamespace;
  sandboxRuntimeAgent: RuntimeAgentNamespace;
}

export function createThinkRuntimeTurnOptions({
  workspaceRuntimeAgent,
  sandboxRuntimeAgent,
}: ThinkRuntimeTurnOptionsInput): Pick<StartComparisonRunOptions, "runWorkspaceTurn" | "runSandboxTurn"> {
  return {
    runWorkspaceTurn: async ({ runId, lease, recorder }) => {
      const agent = workspaceRuntimeAgent.getByName(`${runId}:workspace`);
      for (const event of await agent.runComparison({ runId, leaseId: lease.id })) {
        await recorder.record(event);
      }
    },
    runSandboxTurn: async ({ runId, lease, recorder }) => {
      const agent = sandboxRuntimeAgent.getByName(`${runId}:sandbox`);
      for (const event of await agent.runComparison({ runId, leaseId: lease.id })) {
        await recorder.record(event);
      }
    },
  };
}
