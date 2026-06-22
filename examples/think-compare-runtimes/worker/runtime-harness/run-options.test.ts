import { describe, expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));

import { createComparisonRunOptions, createLiveComparisonRunOptions } from "./run-options";

describe("createComparisonRunOptions", () => {
  test("builds raw Sandbox runtime from a leased Sandbox client", async () => {
    const calls: unknown[] = [];
    const options = createComparisonRunOptions({
      rawSandboxFactory(id, sandboxOptions) {
        calls.push({ id, sandboxOptions });
        return {
          async writeFile(path, contents) {
            calls.push(["writeFile", path, contents.slice(0, 8)]);
          },
          async readFile(path) {
            calls.push(["readFile", path]);
            return "contents";
          },
          async exec(command, execOptions) {
            calls.push(["exec", command, execOptions]);
            return { exitCode: 0, stdout: "checked\n", stderr: "" };
          },
        };
      },
    });

    const lease = await options.rawSandboxPool?.lease();
    expect(lease).toEqual({ id: "raw-sandbox-0" });
    const runtime = await options.createSandboxRuntime?.(lease!);
    await runtime?.seedFixture();
    await expect(runtime?.shell({ command: "npm run check" })).resolves.toMatchObject({
      command: "npm run check",
      exitCode: 0,
    });

    expect(calls[0]).toEqual({ id: "raw-sandbox-0", sandboxOptions: { sleepAfter: "2m" } });
    expect(calls).toContainEqual(["exec", "npm run check", { cwd: "/workspace" }]);
  });

  test("combines raw Sandbox, Workspace, Think, and durable warm pool options", async () => {
    const workspacePool = fakeWarmPool("workspace-container");
    const sandboxPool = fakeWarmPool("sandbox-container");
    const options = createLiveComparisonRunOptions({
      workspaceRuntimeAgent: fakeRuntimeAgent("workspace"),
      sandboxRuntimeAgent: fakeRuntimeAgent("sandbox"),
      workspaceSandboxWarmPool: workspacePool.namespace,
      rawSandboxWarmPool: sandboxPool.namespace,
      createId: () => "fixed",
    });

    const workspaceLease = await options.workspaceSandboxPool?.lease();
    const sandboxLease = await options.rawSandboxPool?.lease();

    expect(workspaceLease).toEqual({ id: "workspace-container", logicalId: "fixed:workspace:0" });
    expect(sandboxLease).toEqual({ id: "sandbox-container", logicalId: "fixed:sandbox:0" });

    await options.workspaceSandboxPool?.release(workspaceLease!);
    await options.rawSandboxPool?.release(sandboxLease!);

    expect(workspacePool.calls).toEqual([
      ["getByName", "default"],
      ["getContainer", "fixed:workspace:0"],
      ["releaseContainer", "fixed:workspace:0"],
    ]);
    expect(sandboxPool.calls).toEqual([
      ["getByName", "default"],
      ["getContainer", "fixed:sandbox:0"],
      ["releaseContainer", "fixed:sandbox:0"],
    ]);
    expect(options.createWorkspaceRuntime).toBeUndefined();
    expect(options.createSandboxRuntime).toBeUndefined();
    expect(options.runWorkspaceTurn).toBeDefined();
    expect(options.runSandboxTurn).toBeDefined();
  });
});

function fakeRuntimeAgent(runtime: "workspace" | "sandbox") {
  return {
    getByName(name: string) {
      return {
        async runComparison() {
          return [{ runtime, kind: "agent_message", title: name, detail: "ok" } as const];
        },
      };
    },
  };
}

function fakeWarmPool(containerId: string) {
  const calls: unknown[] = [];
  return {
    calls,
    namespace: {
      getByName(name: string) {
        calls.push(["getByName", name]);
        return {
          async getContainer(logicalId: string) {
            calls.push(["getContainer", logicalId]);
            return containerId;
          },
          async releaseContainer(logicalId: string) {
            calls.push(["releaseContainer", logicalId]);
          },
        };
      },
    },
  };
}
