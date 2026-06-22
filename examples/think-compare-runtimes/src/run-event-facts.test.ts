import { describe, expect, test } from "vitest";

import type { RunEvent } from "../shared/events";
import { detailFieldsForEvent, factForEvent, factsForRuntime, trimWorkspaceRoot } from "./run-event-facts";

describe("run-event-facts", () => {
  test("normalizes tool phases and execution targets from comparison events", () => {
    const events = [
      event({ sequence: 0, runtime: "both", kind: "run_started", title: "Run started" }),
      event({
        sequence: 1,
        runtime: "workspace",
        kind: "agent_tool_call",
        title: "Think requested read",
        detail: JSON.stringify({ path: "/README.md" }),
      }),
      event({
        sequence: 2,
        runtime: "workspace",
        kind: "agent_tool_result",
        title: "Think run result",
        detail: JSON.stringify({
          executionTarget: "dynamic-worker",
          result: { rootEntries: ["README.md"] },
        }),
      }),
      event({
        sequence: 3,
        runtime: "workspace",
        kind: "agent_tool_result",
        title: "Think shell result",
        detail: JSON.stringify({
          command: "npm run check",
          cwd: "/workspace",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
        }),
      }),
      event({
        sequence: 4,
        runtime: "sandbox",
        kind: "agent_tool_result",
        title: "Think shell result",
        detail: JSON.stringify({
          command: "npm run check",
          cwd: "/workspace",
          exitCode: 1,
          stdout: "",
          stderr: "Missing docs link",
        }),
      }),
    ];

    expect(factsForRuntime(events, "workspace", "runtimeOnly").map((fact) => fact.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(factsForRuntime(events, "workspace", "runtimeOrShared").map((fact) => fact.sequence)).toEqual([
      0, 1, 2, 3,
    ]);

    const read = factForEvent(eventAt(events, 1));
    expect(read.tool).toBe("read");
    expect(read.phase).toBe("call");
    expect(read.path).toBe("/README.md");

    const dynamicWorker = factForEvent(eventAt(events, 2));
    expect(dynamicWorker.tool).toBe("exec");
    expect(dynamicWorker.phase).toBe("result");
    expect(dynamicWorker.command).toBe("Dynamic Worker module");
    expect(dynamicWorker.executionTarget).toBe("dynamic-worker");

    const workspaceShell = factForEvent(eventAt(events, 3));
    expect(workspaceShell.tool).toBe("exec");
    expect(workspaceShell.executionTarget).toBe("workspace-sandbox");
    expect(workspaceShell.validationCommand).toBe(true);
    expect(workspaceShell.failed).toBe(false);

    const rawShell = factForEvent(eventAt(events, 4));
    expect(rawShell.executionTarget).toBe("raw-sandbox");
    expect(rawShell.failed).toBe(true);
  });

  test("formats details and trims the shared workspace root", () => {
    expect(trimWorkspaceRoot("/workspace/docs/index.md")).toBe("docs/index.md");
    expect(trimWorkspaceRoot("/README.md")).toBe("README.md");

    const fields = detailFieldsForEvent(
      event({
        sequence: 1,
        runtime: "workspace",
        kind: "agent_tool_result",
        title: "Think shell result",
        detail: JSON.stringify({
          stdout: "ok\n",
          path: "/workspace/docs/index.md",
          exitCode: 0,
          command: "npm run check",
          cwd: "/workspace",
        }),
      }),
    );

    expect(fields).toEqual([
      { label: "command", value: "npm run check" },
      { label: "path", value: "/workspace/docs/index.md" },
      { label: "cwd", value: "/workspace" },
      { label: "exitCode", value: "0" },
      { label: "stdout", value: "ok\n" },
    ]);
  });
});

function eventAt(events: RunEvent[], index: number): RunEvent {
  const item = events[index];
  if (item === undefined) throw new Error(`Missing event at index ${index}`);
  return item;
}

function event(overrides: Partial<RunEvent> & { sequence: number }): RunEvent {
  return {
    id: `run-1:${overrides.sequence}`,
    runId: "run-1",
    sequence: overrides.sequence,
    runtime: overrides.runtime ?? "workspace",
    kind: overrides.kind ?? "runtime_note",
    title: overrides.title ?? "Event",
    detail: overrides.detail ?? "Detail",
    timestamp: "1970-01-01T00:00:00.000Z",
  } as RunEvent;
}
