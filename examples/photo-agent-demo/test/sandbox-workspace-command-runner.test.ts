import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import type { WorkspaceFileAttachmentHost } from "@cloudflare/workspace";
import { SandboxWorkspaceCommandRunner } from "../src/workspace/sandbox-workspace-command-runner";

const captureSummary = {
  created: [],
  modified: ["/photos/current"],
  deleted: [],
  unchanged: 2,
};

describe("SandboxWorkspaceCommandRunner", () => {
  it("attaches a Workspace file copy, runs the command, and captures changes", async () => {
    const files = new FakeAttachableFiles();
    const sandbox = new FakeSandbox();
    const runner = new SandboxWorkspaceCommandRunner(sandbox);

    const result = await runner.runWorkspaceCommand({
      files,
      root: "/workspace",
      command: "convert /workspace/photos/original.png /workspace/photos/current",
      draftEditId: "draft-1",
    });

    expect(result).toEqual({
      command: "convert /workspace/photos/original.png /workspace/photos/current",
      root: "/workspace",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      capture: captureSummary,
    });
    expect(files.attachCalls).toMatchObject([{ path: "/workspace" }]);
    expect(files.captureCount).toBe(1);
    expect(sandbox.commands).toEqual([
      {
        command: "rm -rf '/workspace' && mkdir -p '/workspace'",
        options: undefined,
      },
      {
        command: "convert /workspace/photos/original.png /workspace/photos/current",
        options: { cwd: "/workspace" },
      },
    ]);
  });

  it("does not capture partial filesystem changes when the command fails", async () => {
    const files = new FakeAttachableFiles();
    const sandbox = new FakeSandbox({ execResult: { success: false, exitCode: 1, stdout: "", stderr: "bad image" } });
    const runner = new SandboxWorkspaceCommandRunner(sandbox);

    await expect(
      runner.runWorkspaceCommand({
        files,
        root: "/workspace",
        command: "convert /workspace/photos/current /workspace/photos/current",
        draftEditId: "draft-1",
      }),
    ).rejects.toThrow("Sandbox command failed: bad image");

    expect(files.captureCount).toBe(0);
  });

  it("reports attachment errors before running the command", async () => {
    const files = new FakeAttachableFiles({ attachError: "mount failed" });
    const sandbox = new FakeSandbox();
    const runner = new SandboxWorkspaceCommandRunner(sandbox);

    await expect(
      runner.runWorkspaceCommand({
        files,
        root: "/workspace",
        command: "convert /workspace/photos/current /workspace/photos/current",
        draftEditId: "draft-1",
      }),
    ).rejects.toThrow("mount failed");

    expect(sandbox.commands).toEqual([]);
  });
});

class FakeAttachableFiles {
  readonly attachCalls: Array<{ host: WorkspaceFileAttachmentHost; path: string }> = [];
  captureCount = 0;

  constructor(private readonly options: { attachError?: string } = {}) {}

  async attach(host: WorkspaceFileAttachmentHost, path: string) {
    if (this.options.attachError) {
      return Result.err({ message: this.options.attachError } as never);
    }

    this.attachCalls.push({ host, path });
    await host.resetDirectory?.(path);
    return Result.ok({
      path,
      capture: async () => {
        this.captureCount += 1;
        return Result.ok(captureSummary);
      },
    });
  }

  async mkdir(_path: string) {
    return Result.ok();
  }

  async write(_path: string, _contents: Uint8Array) {
    return Result.ok();
  }

  async read(_path: string) {
    return Result.ok(new Uint8Array());
  }

  async list(_path: string) {
    return Result.ok([]);
  }

  async stat(path: string) {
    return Result.ok({ path, type: "file" as const, size: 0, createdAt: 1, updatedAt: 1 });
  }

  async delete(_path: string) {
    return Result.ok();
  }
}

class FakeSandbox {
  readonly commands: Array<{ command: string; options: { cwd: string } | undefined }> = [];
  private readonly execResult: { success: boolean; exitCode: number; stdout: string; stderr: string };

  constructor(options?: {
    execResult?: { success: boolean; exitCode: number; stdout: string; stderr: string };
  }) {
    this.execResult = options?.execResult ?? { success: true, exitCode: 0, stdout: "ok", stderr: "" };
  }

  async exec(command: string, options?: { cwd?: string }) {
    this.commands.push({ command, options: options?.cwd ? { cwd: options.cwd } : undefined });
    return this.execResult;
  }

  async mkdir(_path: string, _options: { recursive: boolean }) {}

  async writeFile(_path: string, _content: ReadableStream<Uint8Array>) {}

  async readFile(_path: string, _options: { encoding: "none" }) {
    return { success: true as const, content: new ReadableStream<Uint8Array>() };
  }

  async listFiles(_path: string, _options?: { recursive?: boolean; includeHidden?: boolean }) {
    return { success: true, files: [] };
  }
}
