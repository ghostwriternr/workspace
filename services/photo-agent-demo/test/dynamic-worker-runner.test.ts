import { describe, expect, it } from "vitest";

import { createWorkspaceFileCapability } from "../../control-plane/src/workspace/scoped-file-capability";
import { DynamicWorkerRunner } from "../src/workspace/dynamic-worker-runner";

const originalBytes = new TextEncoder().encode("original");
const noteBytes = new TextEncoder().encode("note");

describe("DynamicWorkerRunner", () => {
  it("loads delegated Worker code with a scoped WORKSPACE binding", async () => {
    const workingCopy = new FakeWorkingCopy({
      "/": { type: "directory" },
      "/photos": { type: "directory" },
      "/photos/original.jpg": { type: "file", contents: originalBytes },
    });
    const loader = new FakeWorkerLoader(async (env) => {
      const workspace = env.WORKSPACE;
      const original = await workspace.readFile("/photos/original.jpg");
      await workspace.writeFile("/notes/edit-summary.md", noteBytes);
      return { originalBytes: original.byteLength };
    });
    const workspace = createTestWorkspaceBinding(workingCopy);
    const runner = new DynamicWorkerRunner(loader);

    await expect(
      runner.runDynamicWorker({
        workspace,
        code: "export default async function(env) { return env.WORKSPACE.stat('/photos/original.jpg'); }",
      }),
    ).resolves.toEqual({ originalBytes: originalBytes.byteLength });
    expect(loader.loaded?.env).toBeUndefined();
    expect(loader.entrypointOptions).toEqual({ props: { WORKSPACE: workspace } });
    await expect(workingCopy.readFile("/notes/edit-summary.md")).resolves.toEqual({ status: "ok", value: noteBytes });
  });

  it("withholds Workspace identity and commit authority from delegated code", async () => {
    const workingCopy = new FakeWorkingCopy({ "/": { type: "directory" }, "/photos": { type: "directory" } });
    const loader = new FakeWorkerLoader(async (env) => ({
      hasCommit: "commit" in env.WORKSPACE,
      hasDiscard: "discard" in env.WORKSPACE,
      hasGetByName: "getByName" in env.WORKSPACE,
      hasBeginSession: "beginSession" in env.WORKSPACE,
    }));
    const runner = new DynamicWorkerRunner(loader);

    await expect(
      runner.runDynamicWorker({ workspace: createTestWorkspaceBinding(workingCopy), code: "export default async function() {}" }),
    ).resolves.toEqual({
      hasCommit: false,
      hasDiscard: false,
      hasGetByName: false,
      hasBeginSession: false,
    });
  });
});

type DelegatedEnv = {
  WORKSPACE: {
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, bytes: Uint8Array): Promise<void>;
    list(path: string): Promise<Array<{ name: string; path: string; type: "directory" | "file" }>>;
    stat(path: string): Promise<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }>;
  };
};

function createTestWorkspaceBinding(workingCopy: FakeWorkingCopy): DelegatedEnv["WORKSPACE"] {
  return createWorkspaceFileCapability({
    workingCopy,
    root: "/",
    read: ["/photos/**"],
    write: ["/photos/**", "/notes/**"],
    delete: false,
  });
}

class FakeWorkerLoader {
  loaded?: { env?: DelegatedEnv; modules: Record<string, string> };
  entrypointOptions?: { props: { WORKSPACE: DelegatedEnv["WORKSPACE"] } };

  constructor(private readonly run: (env: DelegatedEnv) => Promise<unknown>) {}

  load(code: { env?: Record<string, unknown>; modules: Record<string, string> }) {
    this.loaded = { env: code.env as DelegatedEnv | undefined, modules: code.modules };
    return {
      getEntrypoint: (_name?: string, options?: { props: { WORKSPACE: DelegatedEnv["WORKSPACE"] } }) => {
        this.entrypointOptions = options;
        return {
          run: () => this.run({ WORKSPACE: options!.props.WORKSPACE }),
        };
      },
    };
  }
}

type RpcResult<T = unknown> =
  | { status: "ok"; value?: T }
  | { status: "error"; error: { tag: string } };

type Entry =
  | { type: "directory" }
  | { type: "file"; contents: Uint8Array };

class FakeWorkingCopy {
  constructor(private readonly entries: Record<string, Entry>) {}

  async readFile(path: string): Promise<RpcResult<Uint8Array>> {
    const entry = this.entries[path];
    if (!entry) return { status: "error", error: { tag: "PathNotFoundError" } };
    if (entry.type === "directory") return { status: "error", error: { tag: "IsDirectoryError" } };
    return { status: "ok", value: entry.contents };
  }

  async writeFile(path: string, contents: Uint8Array): Promise<RpcResult> {
    const parent = parentPath(path);
    if (!this.entries[parent]) return { status: "error", error: { tag: "PathNotFoundError" } };
    this.entries[path] = { type: "file", contents };
    return { status: "ok" };
  }

  async list(path: string): Promise<RpcResult<Array<{ name: string; path: string; type: "directory" | "file" }>>> {
    if (!this.entries[path]) return { status: "error", error: { tag: "PathNotFoundError" } };
    return { status: "ok", value: [] };
  }

  async stat(path: string): Promise<RpcResult<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }>> {
    const entry = this.entries[path];
    if (!entry) return { status: "error", error: { tag: "PathNotFoundError" } };
    return {
      status: "ok",
      value: {
        path,
        type: entry.type,
        size: entry.type === "file" ? entry.contents.byteLength : null,
        createdAt: 1,
        updatedAt: 1,
      },
    };
  }

  async mkdir(path: string): Promise<RpcResult> {
    if (this.entries[path]) return { status: "ok" };
    const parent = parentPath(path);
    if (!this.entries[parent]) return { status: "error", error: { tag: "PathNotFoundError" } };
    this.entries[path] = { type: "directory" };
    return { status: "ok" };
  }

  async delete(path: string): Promise<RpcResult> {
    delete this.entries[path];
    return { status: "ok" };
  }
}

function parentPath(path: string): string {
  if (path === "/") return "/";
  return path.slice(0, path.lastIndexOf("/")) || "/";
}
