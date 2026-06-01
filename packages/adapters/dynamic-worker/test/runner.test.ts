import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { createWorkspaceDynamicWorkerRunner } from "../src/runner";

const workspace = {
  readFile: async () => ({ status: "error" as const, error: { tag: "PathNotFoundError", message: "missing" } }),
  writeFile: async () => ({ status: "ok" as const }),
  list: async () => ({ status: "ok" as const, value: [] }),
  stat: async () => ({ status: "error" as const, error: { tag: "PathNotFoundError", message: "missing" } }),
};

describe("Workspace Dynamic Worker runner", () => {
  it("loads delegated code with a scoped Workspace binding", async () => {
    const loader = new FakeWorkerLoader(async () => ({ ok: true }));
    const runner = createWorkspaceDynamicWorkerRunner(loader);

    const result = await runner.run({ code: "export default async function() {}", workspace });

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) expect(result.value).toEqual({ ok: true });
    expect(loader.loaded?.globalOutbound).toBeNull();
    expect(loader.loaded?.env).toBeUndefined();
    expect(loader.loaded?.modules["harness.js"]).toContain("workspaceForUserCode");
    expect(loader.entrypointOptions).toEqual({ props: { WORKSPACE: workspace } });
  });

  it("returns a value error when delegated execution throws", async () => {
    const loader = new FakeWorkerLoader(async () => { throw new Error("boom"); });
    const runner = createWorkspaceDynamicWorkerRunner(loader);

    const result = await runner.run({ code: "export default async function() {}", workspace });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({ tag: "WorkspaceDynamicWorkerExecutionError", message: "boom" });
    }
  });

  it("uses Worker RPC entrypoint proxies without static property checks", async () => {
    const loader = new ProxyEntrypointLoader(async () => ({ proxied: true }));
    const runner = createWorkspaceDynamicWorkerRunner(loader);

    const result = await runner.run({ code: "export default async function() {}", workspace });

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) expect(result.value).toEqual({ proxied: true });
  });
});

class FakeWorkerLoader {
  loaded?: { modules: Record<string, string>; env?: Record<string, unknown>; globalOutbound?: null };
  entrypointOptions?: { props: { WORKSPACE: typeof workspace } };

  constructor(private readonly run: () => Promise<unknown>) {}

  load(code: { modules: Record<string, string>; env?: Record<string, unknown>; globalOutbound?: null }) {
    this.loaded = code;
    return {
      getEntrypoint: (_name?: string, options?: { props: { WORKSPACE: typeof workspace } }) => {
        this.entrypointOptions = options;
        return { run: this.run };
      },
    };
  }
}

class ProxyEntrypointLoader {
  constructor(private readonly run: () => Promise<unknown>) {}

  load() {
    return {
      getEntrypoint: () => new Proxy({}, {
        get: (_target, property) => property === "run" ? this.run : undefined,
      }),
    };
  }
}
