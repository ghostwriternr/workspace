import { describe, expect, test } from "vitest";

import { startComparisonRun } from "./runs";

describe("startComparisonRun", () => {
  test("emits ordered terminal events for both runtime wings", async () => {
    const run = await startComparisonRun({ now: fixedClock() });

    expect(run.id).toMatch(/^compare-/);
    expect(run.events.map((event) => event.sequence)).toEqual(run.events.map((_, index) => index));
    expect(run.events[0]).toMatchObject({ runtime: "both", kind: "run_started" });
    expect(run.events.at(-1)).toMatchObject({ runtime: "both", kind: "run_completed" });
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "runtime_started" }),
        expect.objectContaining({ runtime: "workspace", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_started" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "workspace", kind: "tool_call", title: "shell" }),
        expect.objectContaining({ runtime: "sandbox", kind: "tool_call", title: "shell" }),
      ]),
    );
  });

  test("drives lease-scoped runtimes and releases warm Sandbox leases", async () => {
    const calls: string[] = [];
    const run = await startComparisonRun({
      now: fixedClock(),
      createWorkspaceRuntime: (lease) => {
        calls.push(`workspace.runtime:${lease.id}`);
        return fakeWorkspaceRuntime(calls);
      },
      createSandboxRuntime: (lease) => {
        calls.push(`sandbox.runtime:${lease.id}`);
        return fakeSandboxRuntime(calls);
      },
      workspaceSandboxPool: fakePool("workspace", calls),
      rawSandboxPool: fakePool("raw", calls),
    });

    expect(calls).toEqual([
      "workspace.lease",
      "workspace.runtime:workspace-lease",
      "workspace.seed",
      "workspace.run",
      "workspace.shell:npm run check",
      "workspace.release:workspace-lease",
      "sandbox.lease",
      "sandbox.runtime:raw-lease",
      "sandbox.seed",
      "sandbox.shell:npm run check",
      "sandbox.release:raw-lease",
    ]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "container_acquired" }),
        expect.objectContaining({ runtime: "workspace", kind: "container_released" }),
        expect.objectContaining({ runtime: "sandbox", kind: "container_acquired" }),
        expect.objectContaining({ runtime: "sandbox", kind: "container_released" }),
        expect.objectContaining({ runtime: "workspace", kind: "tool_result", title: "run result" }),
        expect.objectContaining({ runtime: "sandbox", kind: "tool_result", title: "shell result" }),
      ]),
    );
  });
});

function fakeWorkspaceRuntime(calls: string[]) {
  return {
    async seedFixture() {
      calls.push("workspace.seed");
    },
    async run() {
      calls.push("workspace.run");
      return { executionTarget: "dynamic-worker" as const, result: { ok: true } };
    },
    async shell(input: { command: string }) {
      calls.push(`workspace.shell:${input.command}`);
      return { command: input.command, cwd: "/workspace/repo", exitCode: 0, stdout: "checked\n", stderr: "" };
    },
  };
}

function fakeSandboxRuntime(calls: string[]) {
  return {
    async seedFixture() {
      calls.push("sandbox.seed");
    },
    async shell(input: { command: string }) {
      calls.push(`sandbox.shell:${input.command}`);
      return { command: input.command, cwd: "/workspace/repo", exitCode: 0, stdout: "checked\n", stderr: "" };
    },
  };
}

function fakePool(prefix: "workspace" | "raw", calls: string[]) {
  return {
    async lease() {
      calls.push(`${prefix === "workspace" ? "workspace" : "sandbox"}.lease`);
      return { id: `${prefix}-lease` };
    },
    async release(lease: { id: string }) {
      calls.push(`${prefix === "workspace" ? "workspace" : "sandbox"}.release:${lease.id}`);
    },
  };
}

function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 5, 16, 0, 0, tick++)).toISOString();
}
