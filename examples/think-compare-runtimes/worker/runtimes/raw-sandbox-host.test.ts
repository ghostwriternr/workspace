import { describe, expect, test } from "vitest";

import { createRawSandboxHostForLease, type RawSandboxFactory } from "./raw-sandbox-host";

describe("createRawSandboxHostForLease", () => {
  test("adapts a leased Sandbox to the raw runtime host shape", async () => {
    const calls: unknown[] = [];
    const factory: RawSandboxFactory = (id, options) => {
      calls.push({ id, options });
      return {
        async writeFile(path, contents) {
          calls.push(["writeFile", path, contents]);
        },
        async readFile(path) {
          calls.push(["readFile", path]);
          return `contents:${path}`;
        },
        async exec(command, options) {
          calls.push(["exec", command, options]);
          return { exitCode: 0, stdout: "ok\n", stderr: "" };
        },
      };
    };

    const host = createRawSandboxHostForLease(factory, { id: "raw-0" });

    await host.writeFile("/workspace/repo/README.md", "hello");
    await expect(host.readFile("/workspace/repo/README.md")).resolves.toBe(
      "contents:/workspace/repo/README.md",
    );
    await expect(host.exec("npm run check", { cwd: "/workspace/repo" })).resolves.toEqual({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
    });

    expect(calls).toEqual([
      { id: "raw-0", options: { sleepAfter: "10m" } },
      ["writeFile", "/workspace/repo/README.md", "hello"],
      ["readFile", "/workspace/repo/README.md"],
      ["exec", "npm run check", { cwd: "/workspace/repo" }],
    ]);
  });
});
