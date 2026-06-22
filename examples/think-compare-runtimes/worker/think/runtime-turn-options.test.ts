import { describe, expect, test } from "vitest";

import { createThinkRuntimeTurnOptions } from "./runtime-turn-options";
import type { RunEventInput, RuntimeTurnRecorder } from "../runs";

describe("createThinkRuntimeTurnOptions", () => {
  test("forwards Workspace and Sandbox agent events into the recorder", async () => {
    const recorded: RunEventInput[] = [];
    const calls: unknown[] = [];
    const options = createThinkRuntimeTurnOptions({
      workspaceRuntimeAgent: fakeRuntimeAgent("workspace", calls),
      sandboxRuntimeAgent: fakeRuntimeAgent("sandbox", calls),
    });
    const recorder: RuntimeTurnRecorder = {
      events: [],
      runId: "compare-test",
      record(input) {
        recorded.push(input);
        return input as never;
      },
    };

    await options.runWorkspaceTurn?.({
      runId: "compare-test",
      lease: { id: "workspace-lease" },
      recorder,
    });
    await options.runSandboxTurn?.({
      runId: "compare-test",
      lease: { id: "sandbox-lease" },
      recorder,
    });

    expect(calls).toEqual([
      { agent: "compare-test:workspace", runId: "compare-test", leaseId: "workspace-lease" },
      { agent: "compare-test:sandbox", runId: "compare-test", leaseId: "sandbox-lease" },
    ]);
    expect(recorded).toEqual([
      { runtime: "workspace", kind: "agent_message", title: "workspace done", detail: "workspace event" },
      { runtime: "sandbox", kind: "agent_message", title: "sandbox done", detail: "sandbox event" },
    ]);
  });
});

function fakeRuntimeAgent(runtime: "workspace" | "sandbox", calls: unknown[]) {
  return {
    getByName(name: string) {
      return {
        async runComparison(input: { runId: string; leaseId: string }) {
          calls.push({ agent: name, ...input });
          return [
            {
              runtime,
              kind: "agent_message",
              title: `${runtime} done`,
              detail: `${runtime} event`,
            },
          ] satisfies RunEventInput[];
        },
      };
    },
  };
}
