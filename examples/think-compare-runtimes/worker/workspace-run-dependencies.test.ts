import { Result } from "better-result";
import { describe, expect, test } from "vitest";

import { createWorkspaceRunOptions } from "./workspace-run-dependencies";

describe("createWorkspaceRunOptions", () => {
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
