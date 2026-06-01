import { describe, expect, it } from "vitest";

import { DynamicWorkerRunner } from "../src/workspace/dynamic-worker-runner";

const readmeBytes = new TextEncoder().encode("# Repo");
const noteBytes = new TextEncoder().encode("edited");

describe("DynamicWorkerRunner", () => {
  it("loads delegated Worker code with a scoped WORKSPACE binding", async () => {
    const workspace = createWorkspaceBinding(new FakeWorkingCopy({
      "/": { type: "directory" },
      "/README.md": { type: "file", contents: readmeBytes },
    }));
    const loader = new FakeWorkerLoader(async (env) => {
      const readme = await env.WORKSPACE.readFile("/README.md");
      await env.WORKSPACE.writeFile("/notes/summary.md", noteBytes);
      return { readmeBytes: readme.byteLength };
    });
    const runner = new DynamicWorkerRunner(loader, { bindingForEdit: () => workspace });

    await expect(runner.runDynamicWorker({
      editCopyId: "copy-1",
      code: "export default async function(env) { return env.WORKSPACE.stat('/README.md'); }",
    })).resolves.toEqual({ readmeBytes: readmeBytes.byteLength });

    expect(loader.loaded?.env).toBeUndefined();
    expect(loader.entrypointOptions).toEqual({ props: { WORKSPACE: workspace } });
  });

  it("does not delegate Workspace identity or publish authority", async () => {
    const workspace = createWorkspaceBinding(new FakeWorkingCopy({ "/": { type: "directory" } }));
    const loader = new FakeWorkerLoader(async (env) => ({
      hasApply: "apply" in env.WORKSPACE,
      hasDiscard: "discard" in env.WORKSPACE,
      hasGetByName: "getByName" in env.WORKSPACE,
      hasCopy: "copy" in env.WORKSPACE,
    }));
    const runner = new DynamicWorkerRunner(loader, { bindingForEdit: () => workspace });

    await expect(runner.runDynamicWorker({ editCopyId: "copy-1", code: "export default async function() {}" })).resolves.toEqual({
      hasApply: false,
      hasDiscard: false,
      hasGetByName: false,
      hasCopy: false,
    });
  });
});

type WorkspaceBinding = {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  list(path: string): Promise<Array<{ name: string; path: string; type: "directory" | "file" }>>;
  stat(path: string): Promise<{ path: string; type: "directory" | "file"; size: number | null; createdAt: number; updatedAt: number }>;
};

type DelegatedEnv = { WORKSPACE: WorkspaceBinding };

class FakeWorkerLoader {
  loaded?: { env?: DelegatedEnv; modules: Record<string, string> };
  entrypointOptions?: { props: { WORKSPACE: WorkspaceBinding } };

  constructor(private readonly run: (env: DelegatedEnv) => Promise<unknown>) {}

  load(code: { env?: Record<string, unknown>; modules: Record<string, string> }) {
    this.loaded = { env: code.env as DelegatedEnv | undefined, modules: code.modules };
    return {
      getEntrypoint: (_name?: string, options?: { props: { WORKSPACE: WorkspaceBinding } }) => {
        this.entrypointOptions = options;
        return { run: () => this.run({ WORKSPACE: options!.props.WORKSPACE }) };
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
    await this.mkdir(parentPath(path));
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
    return { status: "ok", value: { path, type: entry.type, size: entry.type === "file" ? entry.contents.byteLength : null, createdAt: 1, updatedAt: 1 } };
  }

  async mkdir(path: string): Promise<RpcResult> {
    if (this.entries[path]) return { status: "ok" };
    const parent = parentPath(path);
    if (!this.entries[parent]) return { status: "error", error: { tag: "PathNotFoundError" } };
    this.entries[path] = { type: "directory" };
    return { status: "ok" };
  }
}

function createWorkspaceBinding(workingCopy: FakeWorkingCopy): WorkspaceBinding {
  return {
    readFile: async (path) => unwrap(await workingCopy.readFile(path)),
    writeFile: async (path, bytes) => { unwrap(await workingCopy.writeFile(path, bytes)); },
    list: async (path) => unwrap(await workingCopy.list(path)),
    stat: async (path) => unwrap(await workingCopy.stat(path)),
  };
}

function unwrap<T>(result: RpcResult<T>): T {
  if (result.status === "error") throw new Error(result.error.tag);
  return result.value as T;
}

function parentPath(path: string): string {
  if (path === "/") return "/";
  return path.slice(0, path.lastIndexOf("/")) || "/";
}
