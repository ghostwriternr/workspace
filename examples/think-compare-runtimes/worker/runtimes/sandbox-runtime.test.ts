import { describe, expect, test } from "vitest";

import { createRawSandboxRuntime, type RawSandboxHost } from "./sandbox-runtime";

describe("createRawSandboxRuntime", () => {
  test("seeds the fixed fixture under the shared project path", async () => {
    const host = new FakeSandboxHost();
    const runtime = createRawSandboxRuntime(host);

    await runtime.seedFixture();

    expect(host.readText("/workspace/README.md")).toContain("Workers docs fixture");
    expect(host.readText("/workspace/docs/feature-brief.md")).toContain(
      "Smart Request Policies",
    );
  });

  test("offers model-style read write edit and shell tools", async () => {
    const host = new FakeSandboxHost();
    const runtime = createRawSandboxRuntime(host);
    await runtime.seedFixture();

    await expect(runtime.read({ path: "README.md" })).resolves.toContain("Workers docs fixture");
    await expect(runtime.write({ path: "docs/new.md", contents: "# New docs\n" })).resolves.toEqual({
      path: "/workspace/docs/new.md",
    });
    await expect(
      runtime.edit({ path: "docs/new.md", oldText: "# New docs", newText: "# Smart Request Policies" }),
    ).resolves.toEqual({ path: "/workspace/docs/new.md", replacements: 1 });
    await expect(runtime.shell({ command: "npm run check" })).resolves.toEqual({
      command: "npm run check",
      cwd: "/workspace",
      exitCode: 0,
      stdout: "checked\n",
      stderr: "",
    });

    expect(host.readText("/workspace/docs/new.md")).toBe("# Smart Request Policies\n");
  });

  test("verifies the seeded fixture is readable at the shared project path", async () => {
    const host = new FakeSandboxHost([], { dropWrites: true });
    const runtime = createRawSandboxRuntime(host);

    await expect(runtime.seedFixture()).rejects.toThrow("Fixture seed verification failed");
  });

  test("restores the fixture before tool use if the Sandbox session loses files", async () => {
    const host = new FakeSandboxHost();
    const runtime = createRawSandboxRuntime(host);
    await runtime.seedFixture();

    host.clear();

    await expect(runtime.read({ path: "README.md" })).resolves.toContain("Workers docs fixture");
    expect(host.writeCount).toBeGreaterThan(6);
  });

  test("rejects ambiguous exact edits", async () => {
    const host = new FakeSandboxHost([["/workspace/file.txt", "same\nsame\n"]]);
    const runtime = createRawSandboxRuntime(host);

    await expect(
      runtime.edit({ path: "file.txt", oldText: "same", newText: "changed" }),
    ).rejects.toThrow("Expected exactly one match");
  });
});

class FakeSandboxHost implements RawSandboxHost {
  private readonly files = new Map<string, string>();
  writeCount = 0;

  constructor(
    entries: [string, string][] = [],
    private readonly options: { dropWrites?: boolean } = {},
  ) {
    for (const [path, contents] of entries) this.files.set(path, contents);
  }

  async writeFile(path: string, contents: string): Promise<void> {
    this.writeCount += 1;
    if (this.options.dropWrites) return;
    this.files.set(path, contents);
  }

  clear(): void {
    this.files.clear();
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
