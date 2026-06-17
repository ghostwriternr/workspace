import { describe, expect, test } from "vitest";

import { createComparisonRunOptions } from "./run-dependencies";

describe("createComparisonRunOptions", () => {
  test("builds raw Sandbox runtime from a leased Sandbox client", async () => {
    const calls: unknown[] = [];
    const options = createComparisonRunOptions({
      rawSandboxFactory(id, sandboxOptions) {
        calls.push({ id, sandboxOptions });
        return {
          async writeFile(path, contents) {
            calls.push(["writeFile", path, contents.slice(0, 8)]);
          },
          async readFile(path) {
            calls.push(["readFile", path]);
            return "contents";
          },
          async exec(command, execOptions) {
            calls.push(["exec", command, execOptions]);
            return { exitCode: 0, stdout: "checked\n", stderr: "" };
          },
        };
      },
    });

    const lease = await options.rawSandboxPool?.lease();
    expect(lease).toEqual({ id: "raw-sandbox-0" });
    const runtime = options.createSandboxRuntime?.(lease!);
    await runtime?.seedFixture();
    await expect(runtime?.shell({ command: "npm run check" })).resolves.toMatchObject({
      command: "npm run check",
      exitCode: 0,
    });

    expect(calls[0]).toEqual({ id: "raw-sandbox-0", sandboxOptions: { sleepAfter: "10m" } });
    expect(calls).toContainEqual(["exec", "npm run check", { cwd: "/workspace/repo" }]);
  });
});
