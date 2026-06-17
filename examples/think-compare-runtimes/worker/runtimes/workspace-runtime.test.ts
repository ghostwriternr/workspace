import { describe, expect, test } from "vitest";

import { createWorkspaceBackedRuntime, type WorkspaceBackedRuntimeHost } from "./workspace-runtime";

describe("createWorkspaceBackedRuntime", () => {
  test("seeds fixture files and exposes model-style file tools", async () => {
    const host = new FakeWorkspaceHost();
    const runtime = createWorkspaceBackedRuntime(host);

    await runtime.seedFixture();
    await expect(runtime.read({ path: "README.md" })).resolves.toContain("Workers docs fixture");
    await expect(runtime.write({ path: "docs/new.md", contents: "draft" })).resolves.toEqual({
      path: "/docs/new.md",
    });
    await expect(
      runtime.edit({ path: "docs/new.md", oldText: "draft", newText: "ready" }),
    ).resolves.toEqual({ path: "/docs/new.md", replacements: 1 });
    await expect(runtime.read({ path: "/docs/new.md" })).resolves.toBe("ready");
  });

  test("delegates run to Dynamic Worker execution", async () => {
    const host = new FakeWorkspaceHost();
    const runtime = createWorkspaceBackedRuntime(host);

    await expect(runtime.run({ code: "return await env.WORKSPACE.list('/')" })).resolves.toEqual({
      executionTarget: "dynamic-worker",
      result: ["/README.md"],
    });
  });

  test("shell attaches Sandbox and captures changes without exposing capture as a tool", async () => {
    const host = new FakeWorkspaceHost();
    const runtime = createWorkspaceBackedRuntime(host);

    await expect(runtime.shell({ command: "npm run check" })).resolves.toEqual({
      command: "npm run check",
      cwd: "/workspace/repo",
      exitCode: 0,
      stdout: "checked\n",
      stderr: "",
    });

    expect(host.attached).toBe(1);
    expect(host.captured).toBe(1);
  });
});

class FakeWorkspaceHost implements WorkspaceBackedRuntimeHost {
  readonly files = new Map<string, string>([["/README.md", "# Workers docs fixture\n"]]);
  attached = 0;
  captured = 0;

  async writeFile(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }

  async readFile(path: string): Promise<string> {
    const contents = this.files.get(path);
    if (contents === undefined) throw new Error(`Missing fake file: ${path}`);
    return contents;
  }

  async runDynamicWorker(code: string): Promise<unknown> {
    expect(code).toContain("WORKSPACE");
    return ["/README.md"];
  }

  async runSandboxCommand(command: string, options: { cwd: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    this.attached += 1;
    expect(options.cwd).toBe("/workspace/repo");
    return { exitCode: command === "npm run check" ? 0 : 1, stdout: "checked\n", stderr: "" };
  }

  async captureSandboxChanges(): Promise<void> {
    this.captured += 1;
  }
}
