import { Result } from "better-result";
import { describe, expect, test } from "vitest";

import { createWorkspaceRuntimeFactory } from "./workspace-runtime-factory";

describe("createWorkspaceRuntimeFactory", () => {
  test("creates coding runtimes over Workspace working copies", async () => {
    const files = new Map<string, string>();
    const calls: unknown[] = [];
    const createRuntime = createWorkspaceRuntimeFactory({
      workspace: {
        copies: {
          async create(options) {
            calls.push(["copy.create", options]);
            return Result.ok({ id: "copy-1", files: copyFiles(files) });
          },
        },
      },
      async runDynamicWorker(input) {
        calls.push(["dynamic-worker", input.copyId, input.code, input.workspace]);
        return { ok: true };
      },
      async runShell(input) {
        calls.push(["shell", input.copyId, input.lease.id, input.command, input.cwd]);
        return { exitCode: 0, stdout: "checked\n", stderr: "" };
      },
      async captureShell(input) {
        calls.push(["capture", input.copyId, input.lease.id]);
      },
    });

    const runtime = await createRuntime({ id: "lease-1" });

    await runtime.seedFixture();
    await expect(runtime.read({ path: "README.md" })).resolves.toContain("Workers docs fixture");
    await expect(runtime.run({ code: "export default async function () { return 'ok'; }" })).resolves.toEqual({
      executionTarget: "dynamic-worker",
      result: { ok: true },
    });
    await expect(runtime.shell({ command: "npm run check" })).resolves.toMatchObject({
      command: "npm run check",
      exitCode: 0,
    });

    expect(calls).toEqual([
      ["copy.create", { label: "think-runtime-comparison" }],
      ["dynamic-worker", "copy-1", "export default async function () { return 'ok'; }", { scope: "all" }],
      ["shell", "copy-1", "lease-1", "npm run check", "/workspace"],
      ["capture", "copy-1", "lease-1"],
    ]);
  });
});

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
