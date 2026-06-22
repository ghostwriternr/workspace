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

    await host.writeFile("/workspace/README.md", "hello");
    await expect(host.readFile("/workspace/README.md")).resolves.toBe(
      "contents:/workspace/README.md",
    );
    await expect(host.exec("npm run check", { cwd: "/workspace" })).resolves.toEqual({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
    });

    expect(calls).toEqual([
      { id: "raw-0", options: { sleepAfter: "2m" } },
      ["writeFile", "/workspace/README.md", "hello"],
      ["readFile", "/workspace/README.md"],
      ["exec", "npm run check", { cwd: "/workspace" }],
    ]);
  });
});
