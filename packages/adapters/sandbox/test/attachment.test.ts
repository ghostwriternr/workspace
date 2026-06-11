import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { registerWorkspaceCopyRuntimeMount } from "@cloudflare/workspace/runtime-adapter";
import { attachWorkspaceCopyToSandbox } from "../src/index";

describe("attachWorkspaceCopyToSandbox", () => {
  it("mounts a Workspace copy through the adapter container commands", async () => {
    const copy = { id: "copy-123" };
    registerWorkspaceCopyRuntimeMount(copy, async () => Result.ok({
      copyId: "copy-123",
      remote: "https://artifacts.example/workspaces/demo.git",
      baseRef: "main",
      ref: "refs/workspace/copies/copy-123",
    }));
    const sandbox = new FakeSandbox();

    const attached = await attachWorkspaceCopyToSandbox({
      copy,
      sandbox,
      path: "/workspace",
    });

    expect(Result.isOk(attached)).toBe(true);
    if (Result.isError(attached)) return;

    expect(attached.value).toMatchObject({
      copyId: "copy-123",
      path: "/workspace",
    });
    expect(sandbox.commands).toEqual([
      {
        command: "workspace-mount",
        options: {
          cwd: "/",
          env: {
            WORKSPACE_REMOTE: "https://artifacts.example/workspaces/demo.git",
            WORKSPACE_BASE_REF: "main",
            WORKSPACE_COPY_REF: "refs/workspace/copies/copy-123",
            WORKSPACE_PATH: "/workspace",
          },
        },
      },
    ]);

    await sandbox.exec("npm test", { cwd: attached.value.path });
    expect(sandbox.commands.at(-1)).toEqual({ command: "npm test", options: { cwd: "/workspace" } });

    const captured = await attached.value.capture();

    expect(Result.isOk(captured)).toBe(true);
    expect(sandbox.commands.at(-1)).toEqual({
      command: "workspace-capture",
      options: {
        cwd: "/",
        env: {
          WORKSPACE_COPY_REF: "refs/workspace/copies/copy-123",
          WORKSPACE_PATH: "/workspace",
        },
      },
    });
  });
});

class FakeSandbox {
  readonly commands: Array<{ command: string; options: { cwd?: string; env?: Record<string, string> } | undefined }> = [];

  async exec(command: string, options?: { cwd?: string; env?: Record<string, string> }) {
    this.commands.push({ command, options });
    return { success: true, exitCode: 0, stdout: "", stderr: "" };
  }
}
