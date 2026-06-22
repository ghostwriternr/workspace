import { Result } from "better-result";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("@cloudflare/sandbox", () => ({ getSandbox: vi.fn() }));
import { Workspace } from "@cloudflare/workspace";
import { createFakeArtifacts, resetFakeArtifacts } from "@cloudflare/workspace/testing";

import { createWorkspaceRunOptions, createWorkspaceRunOptionsFromBindings } from "./workspace-run-options";

describe("createWorkspaceRunOptions", () => {
  afterEach(() => {
    resetFakeArtifacts();
  });

  test("creates a working-copy runtime over Workspace files", async () => {
    const files = new Map<string, string>();
    const calls: unknown[] = [];
    const options = createWorkspaceRunOptions({
      workspace: {
        copies: {
          async create(options) {
            calls.push(["copy.create", options]);
            return Result.ok({
              id: "copy-1",
              files: copyFiles(files),
            });
          },
        },
      },
      async runDynamicWorker(input) {
        calls.push(["dynamic-worker", input.code]);
        return { ok: true };
      },
      async runShell(input) {
        calls.push(["shell", input.copyId, input.lease.id, input.command]);
        return { exitCode: 0, stdout: "checked\n", stderr: "" };
      },
      async captureShell(input) {
        calls.push(["capture", input.copyId, input.lease.id]);
      },
    });

    const lease = await options.workspaceSandboxPool?.lease();
    const runtime = await options.createWorkspaceRuntime?.(lease!);
    await runtime?.seedFixture();
    await expect(runtime?.read({ path: "README.md" })).resolves.toContain("Workers docs fixture");
    await expect(runtime?.run({ code: "return 1" })).resolves.toEqual({
      executionTarget: "dynamic-worker",
      result: { ok: true },
    });
    await expect(runtime?.shell({ command: "npm run check" })).resolves.toMatchObject({
      command: "npm run check",
      exitCode: 0,
    });

    expect(calls).toEqual([
      ["copy.create", { label: "think-runtime-comparison" }],
      ["dynamic-worker", "return 1"],
      ["shell", "copy-1", "workspace-sandbox-0", "npm run check"],
      ["capture", "copy-1", "workspace-sandbox-0"],
    ]);
  });

  test("retries Workspace Sandbox attachment after a mount failure", async () => {
    const fake = createFakeArtifacts();
    const sandbox = new FakeWorkspaceSandbox({ failMounts: 1 });

    const options = await createWorkspaceRunOptionsFromBindings({
      artifacts: fake.artifacts,
      dynamicWorkers: fakeDynamicWorkers(),
      objects: { getByName: () => fake.object },
      sandboxForLease: () => sandbox,
      workspaceName: "compare-retry",
    });

    const lease = await options.workspaceSandboxPool?.lease();
    const runtime = await options.createWorkspaceRuntime?.(lease!);
    await runtime?.seedFixture();

    await expect(runtime?.shell({ command: "npm run check" })).rejects.toThrow("mount unavailable");
    await expect(runtime?.shell({ command: "npm run check" })).resolves.toMatchObject({ exitCode: 0 });

    expect(sandbox.commands.filter((call) => call.command === "timeout 115s workspace-mount")).toHaveLength(2);
  });

  test("creates live Workspace run options from Worker bindings", async () => {
    const fake = createFakeArtifacts();
    const sandbox = new FakeWorkspaceSandbox();
    const loaderCalls: unknown[] = [];

    const options = await createWorkspaceRunOptionsFromBindings({
      artifacts: fake.artifacts,
      dynamicWorkers: fakeDynamicWorkers(loaderCalls),
      objects: { getByName: () => fake.object },
      sandboxForLease: () => sandbox,
      sandboxPoolPrefix: "live-workspace",
      workspaceForWorkingCopy: (workingCopyId) => ({ capabilityFor: workingCopyId }) as never,
      workspaceName: "compare-live",
    });

    const workspace = Workspace.bind({ artifacts: fake.artifacts, objects: { getByName: () => fake.object } }).get("compare-live");
    const lease = await options.workspaceSandboxPool?.lease();
    expect(lease).toEqual({ id: "live-workspace-0" });
    const runtime = await options.createWorkspaceRuntime?.(lease!);

    await runtime?.seedFixture();
    await expect(runtime?.read({ path: "README.md" })).resolves.toContain("Workers docs fixture");
    await expect(runtime?.run({ code: "export default async function () { return 'ok'; }" })).resolves.toEqual({
      executionTarget: "dynamic-worker",
      result: { inspected: true },
    });
    await expect(runtime?.shell({ command: "npm run check" })).resolves.toMatchObject({
      command: "npm run check",
      exitCode: 0,
    });

    const extraCopy = await workspace.copies.create({ label: "extra-copy" });
    expect(Result.isOk(extraCopy)).toBe(true);
    expect(fake.artifacts.createdRepositories).toEqual(["compare-live"]);
    expect(await fake.object.currentRepository()).toMatchObject({ repository: "compare-live" });
    expect(new TextDecoder().decode(fake.driver.file("compare-live", "/README.md") ?? new Uint8Array())).toContain("Workers docs fixture");
    expect(loaderCalls[0]).toMatchObject({ mainModule: "harness.js" });
    expect(loaderCalls[1]).toMatchObject({ capabilityFor: expect.stringMatching(/^compare-live-copy-/) });
    expect(sandbox.outboundHosts).toHaveLength(1);
    expect(sandbox.commands).toEqual([
      {
        command: "timeout 115s workspace-mount",
        options: expect.objectContaining({
          cwd: "/",
          env: expect.objectContaining({ WORKSPACE_PATH: "/workspace" }),
        }),
      },
      { command: "npm run check", options: { cwd: "/workspace" } },
      {
        command: "timeout 115s workspace-capture",
        options: expect.objectContaining({
          cwd: "/",
          env: expect.objectContaining({ WORKSPACE_PATH: "/workspace" }),
        }),
      },
    ]);
  });
});

function fakeDynamicWorkers(calls: unknown[] = []) {
  return {
    load(input: unknown) {
      calls.push(input);
      return {
        getEntrypoint(_name?: string, entrypointOptions?: { props: { WORKSPACE: unknown } }) {
          calls.push(entrypointOptions?.props.WORKSPACE);
          return { async run() { return { inspected: true }; } };
        },
      };
    },
  };
}

class FakeWorkspaceSandbox {
  readonly commands: Array<{ command: string; options?: { cwd?: string; env?: Record<string, string>; timeout?: number } }> = [];
  readonly outboundHosts: Array<{ hostname: string; methodName: string; params: unknown }> = [];
  private remainingFailedMounts: number;

  constructor(options: { failMounts?: number } = {}) {
    this.remainingFailedMounts = options.failMounts ?? 0;
  }

  async setOutboundByHost(hostname: string, methodName: string, params: unknown) {
    this.outboundHosts.push({ hostname, methodName, params });
  }

  async exec(command: string, options?: { cwd?: string; env?: Record<string, string>; timeout?: number }) {
    this.commands.push({ command, options });
    if (command === "timeout 115s workspace-mount" && this.remainingFailedMounts > 0) {
      this.remainingFailedMounts -= 1;
      return { success: false, exitCode: 1, stdout: "", stderr: "mount unavailable" };
    }
    return {
      success: true,
      exitCode: 0,
      stdout: command === "npm run check" ? "checked\n" : "",
      stderr: "",
    };
  }
}

function copyFiles(files: Map<string, string>) {
  return {
    async writeTree(_root: string, entries: { path: string; contents: Uint8Array }[]) {
      for (const entry of entries) {
        files.set(`/${entry.path}`, new TextDecoder().decode(entry.contents));
      }
      return Result.ok(undefined);
    },
    async read(path: string) {
      const value = files.get(path);
      if (value === undefined) throw new Error(`Missing file: ${path}`);
      return Result.ok(new TextEncoder().encode(value));
    },
    scoped() {
      return { scope: "all" };
    },
  };
}
