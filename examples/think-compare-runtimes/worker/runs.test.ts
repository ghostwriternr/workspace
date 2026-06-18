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

  test("drives lease-scoped Think turns and releases warm Sandbox leases", async () => {
    const calls: string[] = [];
    const run = await startComparisonRun({
      now: fixedClock(),
      async createWorkspaceRuntime(lease) {
        calls.push(`workspace.runtime:${lease.id}`);
        return fakeWorkspaceRuntime(calls);
      },
      createSandboxRuntime: (lease) => {
        calls.push(`sandbox.runtime:${lease.id}`);
        return fakeSandboxRuntime(calls);
      },
      runWorkspaceTurn: async ({ runtime, recorder }) => {
        calls.push("workspace.think-turn");
        await runtime.seedFixture();
        await recorder.record({ runtime: "workspace", kind: "agent_message", title: "Workspace Think response", detail: "workspace done" });
      },
      runSandboxTurn: async ({ runtime, recorder }) => {
        calls.push("sandbox.think-turn");
        await runtime.seedFixture();
        await recorder.record({ runtime: "sandbox", kind: "agent_message", title: "Sandbox Think response", detail: "sandbox done" });
      },
      workspaceSandboxPool: fakePool("workspace", calls),
      rawSandboxPool: fakePool("raw", calls),
    });

    expect(calls).toEqual([
      "workspace.lease",
      "workspace.runtime:workspace-lease",
      "workspace.think-turn",
      "workspace.seed",
      "workspace.release:workspace-lease",
      "sandbox.lease",
      "sandbox.runtime:raw-lease",
      "sandbox.think-turn",
      "sandbox.seed",
      "sandbox.release:raw-lease",
    ]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "container_acquired" }),
        expect.objectContaining({ runtime: "workspace", kind: "container_released" }),
        expect.objectContaining({ runtime: "sandbox", kind: "container_acquired" }),
        expect.objectContaining({ runtime: "sandbox", kind: "container_released" }),
        expect.objectContaining({ runtime: "workspace", kind: "agent_message", detail: "workspace done" }),
        expect.objectContaining({ runtime: "sandbox", kind: "agent_message", detail: "sandbox done" }),
      ]),
    );
  });

  test("lets injected Think turns own runtime construction", async () => {
    const calls: string[] = [];
    const run = await startComparisonRun({
      now: fixedClock(),
      workspaceTurnOwnsRuntime: true,
      sandboxTurnOwnsRuntime: true,
      createWorkspaceRuntime: async () => {
        calls.push("workspace.runtime");
        return fakeWorkspaceRuntime(calls);
      },
      createSandboxRuntime: async () => {
        calls.push("sandbox.runtime");
        return fakeSandboxRuntime(calls);
      },
      runWorkspaceTurn: async ({ recorder }) => {
        calls.push("workspace.turn");
        await recorder.record({ runtime: "workspace", kind: "agent_message", title: "Workspace Think response", detail: "workspace done" });
      },
      runSandboxTurn: async ({ recorder }) => {
        calls.push("sandbox.turn");
        await recorder.record({ runtime: "sandbox", kind: "agent_message", title: "Sandbox Think response", detail: "sandbox done" });
      },
    });

    expect(calls).toEqual(["workspace.turn", "sandbox.turn"]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_completed" }),
      ]),
    );
  });

  test("records failed Think turns without marking the runtime completed", async () => {
    const run = await startComparisonRun({
      now: fixedClock(),
      runWorkspaceTurn: async ({ recorder }) => {
        recorder.record({ runtime: "workspace", kind: "runtime_failed", title: "Think turn failed", detail: "model failed" });
      },
    });

    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "runtime_failed", detail: "model failed" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "both", kind: "run_completed" }),
      ]),
    );
    expect(run.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "runtime_completed" }),
      ]),
    );
  });

  test("turn exceptions become runtime failure events", async () => {
    const run = await startComparisonRun({
      now: fixedClock(),
      runSandboxTurn: async () => {
        throw new Error("sandbox turn crashed");
      },
    });

    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_failed", detail: "sandbox turn crashed" }),
        expect.objectContaining({ runtime: "both", kind: "run_completed" }),
      ]),
    );
    expect(run.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_completed" }),
      ]),
    );
  });
});

function fakeWorkspaceRuntime(calls: string[]) {
  return {
    async seedFixture() {
      calls.push("workspace.seed");
    },
    async read() {
      return "";
    },
    async write(input: { path: string }) {
      return { path: input.path };
    },
    async edit(input: { path: string }) {
      return { path: input.path, replacements: 1 };
    },
    async run(input: { code: string }) {
      calls.push(input.code.includes("export default") ? "workspace.run:module" : "workspace.run:invalid");
      return { executionTarget: "dynamic-worker" as const, result: { ok: true } };
    },
    async shell(input: { command: string }) {
      calls.push(`workspace.shell:${input.command}`);
      return { command: input.command, cwd: "/workspace", exitCode: 0, stdout: "checked\n", stderr: "" };
    },
  };
}

function fakeSandboxRuntime(calls: string[]) {
  return {
    async seedFixture() {
      calls.push("sandbox.seed");
    },
    async read() {
      return "";
    },
    async write(input: { path: string }) {
      return { path: input.path };
    },
    async edit(input: { path: string }) {
      return { path: input.path, replacements: 1 };
    },
    async shell(input: { command: string }) {
      calls.push(`sandbox.shell:${input.command}`);
      return { command: input.command, cwd: "/workspace", exitCode: 0, stdout: "checked\n", stderr: "" };
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
