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
        async writeFile(path: string, contents: string) {
          calls.push(["writeFile", path, contents]);
        },
        async readFile(path: string, options: { encoding: "utf-8" }) {
          calls.push(["readFile", path, options]);
          return { content: "contents" };
        },
        async exec(command: string, options: { cwd: string }) {
          calls.push(["exec", command, options]);
          return { exitCode: 0, stdout: "ok\n", stderr: "" };
        },
      } as never;
    });

    const sandbox = factory("raw-0", { sleepAfter: "10m" });
    await sandbox.writeFile("/workspace/repo/README.md", "hello");
    await expect(sandbox.readFile("/workspace/repo/README.md")).resolves.toBe("contents");
    await expect(sandbox.exec("npm run check", { cwd: "/workspace/repo" })).resolves.toEqual({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
    });

    expect(calls).toEqual([
      { binding: namespace, id: "raw-0", options: { sleepAfter: "10m" } },
      ["writeFile", "/workspace/repo/README.md", "hello"],
      ["readFile", "/workspace/repo/README.md", { encoding: "utf-8" }],
      ["exec", "npm run check", { cwd: "/workspace/repo" }],
    ]);
  });
});
