import { describe, expect, test } from "vitest";

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

  test("combines raw Sandbox, Workspace, and Think runtime options", async () => {
    const options = createLiveComparisonRunOptions({
      workspaceRuntimeAgent: fakeRuntimeAgent("workspace"),
      sandboxRuntimeAgent: fakeRuntimeAgent("sandbox"),
      createId: () => "fixed",
    });

    expect((await options.workspaceSandboxPool?.lease())?.id).toBe("workspace-sandbox-fixed-0");
    expect((await options.rawSandboxPool?.lease())?.id).toBe("raw-sandbox-fixed-0");
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
