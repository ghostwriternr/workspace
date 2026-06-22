import { describe, expect, test, vi } from "vitest";

vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: vi.fn(),
}));

import { createRawSandboxFactory } from "./cloudflare-sandbox";

describe("createRawSandboxFactory", () => {
  test("creates Sandbox SDK clients with long-lived warm leases", async () => {
    const calls: unknown[] = [];
    const namespace = { binding: "Sandbox" } as never;
    const factory = createRawSandboxFactory(namespace, (binding, id, options) => {
      calls.push({ binding, id, options });
      return {
        async createSession(options: { id: string; cwd: string }) {
          calls.push(["createSession", options]);
          return {
            async mkdir(path: string, mkdirOptions: { recursive: boolean }) {
              calls.push(["mkdir", path, mkdirOptions]);
              return { success: true, path, recursive: mkdirOptions.recursive, timestamp: "now" };
            },
            async writeFile(path: string, contents: string, writeOptions: { encoding: "utf-8" }) {
              calls.push(["writeFile", path, contents, writeOptions]);
              return { success: true, path, timestamp: "now" };
            },
            async readFile(path: string, readOptions: { encoding: "utf-8" }) {
              calls.push(["readFile", path, readOptions]);
              return { success: true, path, content: "contents", timestamp: "now" };
            },
            async exec(command: string, execOptions: { cwd: string }) {
              calls.push(["exec", command, execOptions]);
              return { exitCode: 0, stdout: "ok\n", stderr: "" };
            },
          };
        },
      } as never;
    });

    const sandbox = factory("raw-0", { sleepAfter: "10m" });
    await sandbox.writeFile("/workspace/README.md", "hello");
    await expect(sandbox.readFile("/workspace/README.md")).resolves.toBe("contents");
    await expect(sandbox.exec("npm run check", { cwd: "/workspace" })).resolves.toEqual({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
    });

    expect(calls).toEqual([
      { binding: namespace, id: "raw-0", options: { sleepAfter: "10m" } },
      ["createSession", { id: "raw-0-runtime", cwd: "/" }],
      ["mkdir", "/workspace", { recursive: true }],
      ["writeFile", "/workspace/README.md", "hello", { encoding: "utf-8" }],
      ["readFile", "/workspace/README.md", { encoding: "utf-8" }],
      ["exec", "npm run check", { cwd: "/workspace" }],
    ]);
  });

  test("surfaces failed Sandbox file writes", async () => {
    const namespace = { binding: "Sandbox" } as never;
    const factory = createRawSandboxFactory(namespace, () => ({
      async createSession() {
        return {
          async mkdir(path: string) {
            return { success: false, path, recursive: true, timestamp: "now" };
          },
          async writeFile(path: string) {
            return { success: true, path, timestamp: "now" };
          },
          async readFile(path: string) {
            return { success: true, path, content: "", timestamp: "now" };
          },
          async exec() {
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        };
      },
    }) as never);

    const sandbox = factory("raw-0", { sleepAfter: "10m" });
    await expect(sandbox.writeFile("/workspace/README.md", "hello")).rejects.toThrow(
      "Sandbox mkdir failed: /workspace",
    );
  });
});
