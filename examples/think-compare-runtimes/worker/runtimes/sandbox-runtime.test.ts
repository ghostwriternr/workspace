import { describe, expect, test } from "vitest";

import { createRawSandboxRuntime, type RawSandboxHost } from "./sandbox-runtime";

describe("createRawSandboxRuntime", () => {
  test("seeds the fixed fixture under the shared project path", async () => {
    const host = new FakeSandboxHost();
    const runtime = createRawSandboxRuntime(host);

    await runtime.seedFixture();

    expect(host.readText("/workspace/repo/README.md")).toContain("Workers docs fixture");
    expect(host.readText("/workspace/repo/docs/feature-brief.md")).toContain(
      "Smart Request Policies",
    );
  });

  test("offers model-style read write edit and shell tools", async () => {
    const host = new FakeSandboxHost();
    const runtime = createRawSandboxRuntime(host);
    await runtime.seedFixture();

    await expect(runtime.read({ path: "README.md" })).resolves.toContain("Workers docs fixture");
    await expect(runtime.write({ path: "docs/new.md", contents: "# New docs\n" })).resolves.toEqual({
      path: "/workspace/repo/docs/new.md",
    });
    await expect(
      runtime.edit({ path: "docs/new.md", oldText: "# New docs", newText: "# Smart Request Policies" }),
    ).resolves.toEqual({ path: "/workspace/repo/docs/new.md", replacements: 1 });
    await expect(runtime.shell({ command: "npm run check" })).resolves.toEqual({
      command: "npm run check",
      cwd: "/workspace/repo",
      exitCode: 0,
      stdout: "checked\n",
      stderr: "",
    });

    expect(host.readText("/workspace/repo/docs/new.md")).toBe("# Smart Request Policies\n");
  });

  test("rejects ambiguous exact edits", async () => {
    const host = new FakeSandboxHost([["/workspace/repo/file.txt", "same\nsame\n"]]);
    const runtime = createRawSandboxRuntime(host);

    await expect(
      runtime.edit({ path: "file.txt", oldText: "same", newText: "changed" }),
    ).rejects.toThrow("Expected exactly one match");
  });
});

class FakeSandboxHost implements RawSandboxHost {
  private readonly files = new Map<string, string>();

  constructor(entries: [string, string][] = []) {
    for (const [path, contents] of entries) this.files.set(path, contents);
  }

  async writeFile(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }

  async readFile(path: string): Promise<string> {
    return this.readText(path);
  }

  async exec(command: string, options: { cwd: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return { exitCode: 0, stdout: command === "npm run check" ? "checked\n" : "", stderr: "" };
  }

  readText(path: string): string {
    const contents = this.files.get(path);
    if (contents === undefined) throw new Error(`Missing fake file: ${path}`);
    return contents;
  }
}
