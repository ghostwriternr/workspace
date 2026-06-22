import { describe, expect, test } from "vitest";

import type { RunEvent } from "../shared/events";
import { buildDashboardModel } from "./dashboard-model";
import { buildRuntimePanelModel } from "./runtime-panel-model";

describe("buildRuntimePanelModel", () => {
  test("builds Workspace lanes from file, Dynamic Worker, and Sandbox events", () => {
    const events = [
      event({ sequence: 0, runtime: "workspace", kind: "runtime_started", timestamp: "2026-06-16T00:00:00.000Z" }),
      event({
        sequence: 1,
        runtime: "workspace",
        kind: "agent_tool_call",
        title: "Think requested read",
        detail: JSON.stringify({ path: "/README.md" }),
        timestamp: "2026-06-16T00:00:01.000Z",
      }),
      event({
        sequence: 2,
        runtime: "workspace",
        kind: "agent_tool_result",
        title: "Think run result",
        detail: JSON.stringify({ executionTarget: "dynamic-worker", result: { readmeBytes: 42 } }),
        timestamp: "2026-06-16T00:00:03.000Z",
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
          stdout: "docs check passed",
          stderr: "",
        }),
        timestamp: "2026-06-16T00:00:10.000Z",
      }),
      event({
        sequence: 4,
        runtime: "workspace",
        kind: "agent_message_delta",
        title: "Think response stream",
        detail: "I am updating the docs.",
        timestamp: "2026-06-16T00:00:11.000Z",
      }),
      event({
        sequence: 5,
        runtime: "workspace",
        kind: "agent_message",
        title: "Think turn complete",
        detail: "Updated the docs and verified them.",
        timestamp: "2026-06-16T00:00:12.000Z",
      }),
    ];
    const telemetry = buildDashboardModel(events, "2026-06-16T00:00:12.000Z").runtimes.workspace;

    const model = buildRuntimePanelModel(events, "workspace", telemetry);

    expect(model.summary).toEqual([
      { label: "File ops", value: "1" },
      { label: "Dynamic worker", value: "1" },
      { label: "Sandbox commands", value: "1" },
    ]);
    expect(model.lanes.map((lane) => lane.label)).toEqual(["Files", "Dynamic Worker", "Sandbox"]);
    expect(model.lanes[0]?.markers.map((marker) => marker.label)).toEqual(["read README.md"]);
    expect(model.lanes[1]?.segments.map((segment) => segment.label)).toEqual(["Dynamic Worker module"]);
    expect(model.lanes[2]?.segments.map((segment) => [segment.label, segment.status])).toEqual([
      ["npm run check", "passed"],
    ]);
    expect(model.workItems).toMatchObject([
      { kind: "read", label: "Read files", text: "1 file · README.md", presentation: "compact" },
      {
        kind: "exec",
        label: "Ran Dynamic Worker",
        command: "Dynamic Worker module",
        executionTarget: "dynamic-worker",
        presentation: "terminal",
      },
      {
        kind: "exec",
        label: "Ran command",
        command: "npm run check",
        executionTarget: "workspace-sandbox",
        exitCode: 0,
        presentation: "terminal",
      },
      {
        kind: "message",
        label: "Response",
        text: "I am updating the docs.\n\nUpdated the docs and verified them.",
        presentation: "markdown",
      },
    ]);
  });

  test("builds raw Sandbox as a container-only runtime with validation failure", () => {
    const events = [
      event({ sequence: 0, runtime: "sandbox", kind: "runtime_started", timestamp: "2026-06-16T00:00:00.000Z" }),
      event({
        sequence: 1,
        runtime: "sandbox",
        kind: "agent_tool_call",
        title: "Think requested write",
        detail: JSON.stringify({ path: "/workspace/docs/smart-request-policies.md" }),
        timestamp: "2026-06-16T00:00:03.000Z",
      }),
      event({
        sequence: 2,
        runtime: "sandbox",
        kind: "agent_tool_result",
        title: "Think shell result",
        detail: JSON.stringify({
          command: "npm run check",
          cwd: "/workspace",
          exitCode: 1,
          stdout: "",
          stderr: "Missing nav entry",
        }),
        timestamp: "2026-06-16T00:00:09.000Z",
      }),
    ];
    const telemetry = buildDashboardModel(events, "2026-06-16T00:01:00.000Z").runtimes.sandbox;

    const model = buildRuntimePanelModel(events, "sandbox", telemetry);

    expect(model.summary).toEqual([
      { label: "File ops", value: "1" },
      { label: "Sandbox commands", value: "1" },
    ]);
    expect(model.lanes.map((lane) => lane.label)).toEqual(["Files", "Dynamic Worker", "Sandbox"]);
    expect(model.lanes[0]?.markers).toEqual([]);
    expect(model.lanes[1]?.segments).toEqual([]);
    expect(model.lanes[2]?.markers.map((marker) => marker.label)).toEqual([
      "write docs/smart-request-policies.md",
    ]);
    expect(model.lanes[2]?.segments.map((segment) => [segment.label, segment.status])).toEqual([
      ["Session setup", "neutral"],
      ["npm run check", "failed"],
    ]);
  });

  test("shows runtime setup notes and retry messages as visible work activity", () => {
    const events = [
      event({
        sequence: 0,
        runtime: "workspace",
        kind: "runtime_note",
        title: "Preparing Workspace runtime",
        detail: "Opening Workspace and creating a working copy.",
      }),
      event({
        sequence: 1,
        runtime: "workspace",
        kind: "runtime_note",
        title: "Fixture seeded",
        detail: "Fixture seeded into a Workspace working copy.",
      }),
      event({
        sequence: 2,
        runtime: "workspace",
        kind: "agent_message",
        title: "Retrying Kimi turn",
        detail: "Attempt 1 failed with a transient error. Retrying with Kimi.",
      }),
    ];
    const telemetry = buildDashboardModel(events, "2026-06-16T00:00:13.000Z").runtimes.workspace;

    const model = buildRuntimePanelModel(events, "workspace", telemetry);

    expect(model.workItems).toMatchObject([
      {
        kind: "step",
        label: "Preparing Workspace runtime",
        text: "Opening Workspace and creating a working copy.",
        presentation: "compact",
      },
      {
        kind: "step",
        label: "Fixture seeded",
        text: "Fixture seeded into a Workspace working copy.",
        presentation: "compact",
      },
      {
        kind: "step",
        label: "Retrying Kimi turn",
        text: "Attempt 1 failed with a transient error. Retrying with Kimi.",
        presentation: "compact",
      },
    ]);
  });

  test("groups thinking, reads, edits, and shell commands by intent", () => {
    const events = [
      event({ sequence: 0, runtime: "workspace", kind: "agent_thinking_delta", detail: "I need context.\n" }),
      event({ sequence: 1, runtime: "workspace", kind: "agent_tool_call", title: "Think requested read", detail: JSON.stringify({ path: "/README.md" }) }),
      event({ sequence: 2, runtime: "workspace", kind: "agent_tool_result", title: "Think read result", detail: JSON.stringify({ path: "/README.md" }) }),
      event({ sequence: 3, runtime: "workspace", kind: "agent_tool_call", title: "Think requested read", detail: JSON.stringify({ path: "/docs/security.md" }) }),
      event({ sequence: 4, runtime: "workspace", kind: "agent_tool_result", title: "Think read result", detail: JSON.stringify({ path: "/docs/security.md" }) }),
      event({ sequence: 5, runtime: "workspace", kind: "agent_thinking_delta", detail: "I can edit now.\n" }),
      event({ sequence: 6, runtime: "workspace", kind: "agent_tool_call", title: "Think requested edit", detail: JSON.stringify({ path: "/docs/security.md" }) }),
      event({ sequence: 7, runtime: "workspace", kind: "agent_tool_result", title: "Think edit result", detail: JSON.stringify({ path: "/docs/security.md" }) }),
    ];
    const telemetry = buildDashboardModel(events, "2026-06-16T00:00:13.000Z").runtimes.workspace;

    const model = buildRuntimePanelModel(events, "workspace", telemetry);

    expect(model.workItems).toMatchObject([
      { kind: "thinking", text: "I need context.\nI can edit now.\n", presentation: "markdown" },
      { kind: "read", count: 2, text: "2 files · README.md · docs/security.md", presentation: "compact" },
      { kind: "edit", label: "Edited file", text: "docs/security.md · applied", presentation: "compact" },
    ]);
  });
});

function event(overrides: Partial<RunEvent> & { sequence: number }): RunEvent {
  return {
    id: `run-1:${overrides.sequence}`,
    runId: "run-1",
    sequence: overrides.sequence,
    runtime: overrides.runtime ?? "workspace",
    kind: overrides.kind ?? "runtime_note",
    title: overrides.title ?? "Event",
    detail: overrides.detail ?? "Detail",
    timestamp: overrides.timestamp ?? "1970-01-01T00:00:00.000Z",
  } as RunEvent;
}
