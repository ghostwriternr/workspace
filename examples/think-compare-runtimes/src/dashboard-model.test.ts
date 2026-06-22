import { describe, expect, test } from "vitest";

import type { EventRuntime, RunEvent, RunEventKind } from "../shared/events";
import { buildDashboardModel } from "./dashboard-model";

describe("buildDashboardModel", () => {
  test("derives idle telemetry before a run starts", () => {
    const model = buildDashboardModel([], null);

    expect(model.run.status).toBe("idle");
    expect(model.run.actionLabel).toBe("START RUN");
    expect(model.runtimes.workspace.container).toBe("warm");
    expect(model.runtimes.sandbox.container).toBe("warm");
    expect(model.runtimes.workspace.toolCalls).toBe(0);
    expect(model.runtimes.sandbox.execCalls).toBe(0);
  });

  test("counts Workspace dynamic worker and sandbox execution separately", () => {
    const model = buildDashboardModel(
      [
        event({ sequence: 0, runtime: "both", kind: "run_started" }),
        event({ sequence: 1, runtime: "workspace", kind: "runtime_started" }),
        event({ sequence: 2, runtime: "sandbox", kind: "runtime_started" }),
        event({
          sequence: 3,
          runtime: "workspace",
          kind: "tool_call",
          title: "run called",
          detail: JSON.stringify({ name: "run", executionTarget: "dynamic-worker" }),
        }),
        event({
          sequence: 4,
          runtime: "workspace",
          kind: "tool_call",
          title: "shell called",
          detail: JSON.stringify({ name: "shell", executionTarget: "workspace-sandbox" }),
        }),
        event({
          sequence: 5,
          runtime: "sandbox",
          kind: "tool_call",
          title: "shell called",
          detail: JSON.stringify({ name: "shell", executionTarget: "raw-sandbox" }),
        }),
      ],
      "2026-06-16T00:00:08.000Z",
    );

    expect(model.runtimes.workspace.toolCalls).toBe(2);
    expect(model.runtimes.workspace.execCalls).toBe(2);
    expect(model.runtimes.workspace.dynamicWorkerExecs).toBe(1);
    expect(model.runtimes.workspace.sandboxExecs).toBe(1);
    expect(model.runtimes.sandbox.toolCalls).toBe(1);
    expect(model.runtimes.sandbox.execCalls).toBe(1);
    expect(model.runtimes.sandbox.dynamicWorkerExecs).toBe(0);
    expect(model.runtimes.sandbox.sandboxExecs).toBe(1);
  });

  test("uses terminal timestamps for completed runs", () => {
    const model = buildDashboardModel(
      [
        event({ sequence: 0, runtime: "both", kind: "run_started", timestamp: "2026-06-16T00:00:00.000Z" }),
        event({ sequence: 1, runtime: "workspace", kind: "runtime_started", timestamp: "2026-06-16T00:00:02.000Z" }),
        event({ sequence: 2, runtime: "workspace", kind: "runtime_completed", timestamp: "2026-06-16T00:02:51.000Z" }),
        event({ sequence: 3, runtime: "sandbox", kind: "runtime_started", timestamp: "2026-06-16T00:00:01.000Z" }),
        event({ sequence: 4, runtime: "sandbox", kind: "runtime_completed", timestamp: "2026-06-16T00:03:42.000Z" }),
        event({ sequence: 5, runtime: "both", kind: "run_completed", timestamp: "2026-06-16T00:03:42.000Z" }),
      ],
      "2026-06-16T00:10:00.000Z",
    );

    expect(model.run.status).toBe("completed");
    expect(model.run.actionLabel).toBe("RUN AGAIN");
    expect(model.run.elapsedLabel).toBe("03:42");
    expect(model.runtimes.workspace.elapsedLabel).toBe("02:49");
    expect(model.runtimes.sandbox.elapsedLabel).toBe("03:41");
  });
});

function event(overrides: Partial<RunEvent> & { sequence: number }): RunEvent {
  return {
    id: `run-1:${overrides.sequence}`,
    runId: "run-1",
    sequence: overrides.sequence,
    runtime: (overrides.runtime ?? "both") as EventRuntime,
    kind: (overrides.kind ?? "run_started") as RunEventKind,
    title: overrides.title ?? "Event",
    detail: overrides.detail ?? "Detail",
    timestamp: overrides.timestamp ?? "2026-06-16T00:00:00.000Z",
  };
}
