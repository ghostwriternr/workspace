import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import type { WorkspaceFileCopyFiles, WorkspaceFileMount, WorkspaceFileMountError, WorkspaceFileMountHost } from "@cloudflare/workspace";
import { createWorkspaceSandboxCommandRunner, type WorkspaceSandboxClient } from "../src/runner";

const reconcileSummary = {
  created: ["/notes/shell.md"],
  modified: [],
  deleted: [],
  unchanged: 1,
};

describe("Workspace Sandbox command runner", () => {
  it("attaches files, runs a shell command, and reconciles the mount", async () => {
    const files = new FakeAttachableFiles();
    const sandbox = new FakeSandbox();
    const runner = createWorkspaceSandboxCommandRunner(sandbox);

    const result = await runner.runCommand({
      files,
      sandboxId: "copy-1",
      root: "/workspace",
      command: "npm test",
    });

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual({
        command: "npm test",
        root: "/workspace",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        reconcile: reconcileSummary,
      });
    }
    expect(files.reconcileCount).toBe(1);
    expect(sandbox.commands).toEqual([
      { command: "rm -rf '/workspace' && mkdir -p '/workspace'", options: undefined },
      { command: "npm test", options: { cwd: "/workspace" } },
    ]);
  });

  it("reconciles mounted files after a nonzero exit", async () => {
    const files = new FakeAttachableFiles();
    const sandbox = new FakeSandbox({ exitCode: 1, stdout: "", stderr: "failed" });
    const runner = createWorkspaceSandboxCommandRunner(sandbox);

    const result = await runner.runCommand({
      files,
      sandboxId: "copy-1",
      root: "/workspace",
      command: "npm test",
    });

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toMatchObject({ exitCode: 1, stdout: "", stderr: "failed", reconcile: reconcileSummary });
    }
    expect(files.reconcileCount).toBe(1);
  });

  it("uses a sandbox factory keyed by working copy", async () => {
    const files = new FakeAttachableFiles();
    const sandboxes = new Map<string, FakeSandbox>();
    const runner = createWorkspaceSandboxCommandRunner((sandboxId) => {
      const sandbox = new FakeSandbox();
      sandboxes.set(sandboxId, sandbox);
      return sandbox;
    });

    const result = await runner.runCommand({
      files,
      sandboxId: "working-copy-123",
      root: "/workspace",
      command: "pwd",
    });

    expect(Result.isOk(result)).toBe(true);
    expect([...sandboxes.keys()]).toEqual(["working-copy-123"]);
  });

  it("returns value errors for mount, execution, and reconcile failures", async () => {
    await expectError(
      createWorkspaceSandboxCommandRunner(new FakeSandbox()).runCommand({
        files: new FakeAttachableFiles({ attachError: "mount failed" }),
        sandboxId: "copy-1",
        root: "/workspace",
        command: "npm test",
      }),
      "WorkspaceSandboxMountError",
      "mount failed",
    );

    await expectError(
      createWorkspaceSandboxCommandRunner(new FakeSandbox({ execError: new Error("reset failed"), execErrorOnCommand: "rm -rf '/workspace' && mkdir -p '/workspace'" })).runCommand({
        files: new FakeAttachableFiles(),
        sandboxId: "copy-1",
        root: "/workspace",
        command: "npm test",
      }),
      "WorkspaceSandboxMountError",
      "reset failed",
    );

    await expectError(
      createWorkspaceSandboxCommandRunner(new FakeSandbox({ execError: new Error("exec failed"), execErrorOnCommand: "npm test" })).runCommand({
        files: new FakeAttachableFiles(),
        sandboxId: "copy-1",
        root: "/workspace",
        command: "npm test",
      }),
      "WorkspaceSandboxExecutionError",
      "exec failed",
    );

    await expectError(
      createWorkspaceSandboxCommandRunner(new FakeSandbox()).runCommand({
        files: new FakeAttachableFiles({ reconcileError: "reconcile failed" }),
        sandboxId: "copy-1",
        root: "/workspace",
        command: "npm test",
      }),
      "WorkspaceSandboxMountError",
      "reconcile failed",
    );
  });
});

class FakeAttachableFiles implements Pick<WorkspaceFileCopyFiles, "attach"> {
  reconcileCount = 0;

  constructor(private readonly options: { attachError?: string; reconcileError?: string } = {}) {}

  async attach(host: WorkspaceFileMountHost, path: string) {
    if (this.options.attachError) {
      return Result.err(mountOperationError(this.options.attachError));
    }

    await host.resetDirectory?.(path);
    const mount: WorkspaceFileMount = {
      path,
      reconcile: async () => {
        this.reconcileCount += 1;
        if (this.options.reconcileError) {
          return Result.err(mountOperationError(this.options.reconcileError));
        }
        return Result.ok(reconcileSummary);
      },
    };
    return Result.ok(mount);
  }
}

function mountOperationError(message: string): WorkspaceFileMountError {
  return {
    tag: "WorkspaceFileMountOperationError",
    operation: "test",
    errorTag: "TestError",
    message,
  };
}

class FakeSandbox implements WorkspaceSandboxClient {
  readonly commands: Array<{ command: string; options: { cwd: string } | undefined }> = [];

  constructor(private readonly options: { exitCode?: number; stdout?: string; stderr?: string; execError?: Error; execErrorOnCommand?: string } = {}) {}

  async exec(command: string, options?: { cwd?: string }) {
    this.commands.push({ command, options: options?.cwd ? { cwd: options.cwd } : undefined });
    if (this.options.execError && (!this.options.execErrorOnCommand || this.options.execErrorOnCommand === command)) throw this.options.execError;
    return {
      success: this.options.exitCode === undefined || this.options.exitCode === 0,
      exitCode: this.options.exitCode ?? 0,
      stdout: this.options.stdout ?? "ok",
      stderr: this.options.stderr ?? "",
    };
  }

  async mkdir(_path: string, _options: { recursive: boolean }) {}

  async writeFile(_path: string, _content: ReadableStream<Uint8Array>) {}

  async readFile(_path: string, _options: { encoding: "none" }) {
    return { success: true as const, content: new ReadableStream<Uint8Array>() };
  }

  async listFiles(_path: string, _options?: { recursive?: boolean; includeHidden?: boolean }) {
    return { success: true as const, files: [] };
  }
}

async function expectError(promise: Promise<unknown>, tag: string, message: string) {
  const result = await promise as { status: "ok" } | { status: "error"; error: { tag: string; message: string } };
  expect(result.status).toBe("error");
  if (result.status === "error") {
    expect(result.error).toMatchObject({ tag, message });
  }
}
