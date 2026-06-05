import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import type { WorkspaceFileCopyFiles } from "@cloudflare/workspace";

import { PhotoDraftController } from "../../src/photo/draft-controller";

const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const currentPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);
const draftPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3]);

describe("PhotoDraftController", () => {
  it("starts a durable draft edit and reports passive photo state", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng, "/notes/edit-summary.md": new TextEncoder().encode("note") },
    });
    const controller = new PhotoDraftController(dependencies);

    const draft = await controller.startDraft();
    const state = await controller.listPhotoState();

    expect(draft).toEqual({
      status: "draft-ready",
      draftEditId: "session-1",
      message: "Draft edit is ready.",
    });
    expect(state).toMatchObject({
      workspaceName: "demo",
      original: { exists: true, path: "/photos/original.png", bytes: originalPng.byteLength },
      current: { exists: false },
      draft: { exists: false, draftEditId: "session-1" },
    });
    expect(state.files.map((file) => file.path)).toEqual(["/notes/edit-summary.md", "/photos/original.png"]);
  });

  it("runs commands with the draft mounted at /workspace and reconciles changes into the draft", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      commandOutput: draftPng,
    });
    const controller = new PhotoDraftController(dependencies);

    const result = await controller.runWorkspaceCommand({
      command: "identify /workspace/photos/original.png && convert /workspace/photos/original.png /workspace/photos/current",
    });

    expect(result).toEqual({
      status: "command-completed",
      root: "/workspace",
      command: "identify /workspace/photos/original.png && convert /workspace/photos/original.png /workspace/photos/current",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      reconcile: {
        created: [],
        modified: ["/photos/current"],
        deleted: [],
        unchanged: 1,
      },
    });
    expect(dependencies.workspace.beginSessionCount).toBe(1);
    expect(dependencies.sessionFiles["/photos/current"]).toEqual(draftPng);
    expect(dependencies.commandRunner.calls).toEqual([
      {
        command: "identify /workspace/photos/original.png && convert /workspace/photos/original.png /workspace/photos/current",
        root: "/workspace",
        draftEditId: "session-1",
      },
    ]);
  });

  it("reuses the existing draft for follow-up workspace commands", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      session: { "/photos/current": currentPng },
      draftEditId: "session-1",
      commandOutput: draftPng,
    });
    const controller = new PhotoDraftController(dependencies);

    await controller.runWorkspaceCommand({
      command: "convert /workspace/photos/current -resize 512x512^ /workspace/photos/current",
    });

    expect(dependencies.workspace.beginSessionCount).toBe(0);
    expect(dependencies.commandRunner.calls).toEqual([
      {
        command: "convert /workspace/photos/current -resize 512x512^ /workspace/photos/current",
        root: "/workspace",
        draftEditId: "session-1",
      },
    ]);
    expect(dependencies.sessionFiles["/photos/current"]).toEqual(draftPng);
  });

  it("runs Dynamic Worker code against the same draft working copy", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      session: { "/photos/current": currentPng },
      draftEditId: "session-1",
    });
    const controller = new PhotoDraftController(dependencies);

    const result = await controller.runDynamicWorker({
      code: "export default async function(env) { const write = await env.WORKSPACE.writeFile('/notes/edit-summary.md', new TextEncoder().encode('cropped square')); if (write.status === 'error') return write; }",
    });

    expect(result).toEqual({
      status: "dynamic-worker-completed",
      summary: "Dynamic Worker finished.",
      result: { wrote: "/notes/edit-summary.md" },
    });
    expect(dependencies.workspace.beginSessionCount).toBe(0);
    expect(dependencies.dynamicWorkerRunner.calls).toEqual([
      {
        code: "export default async function(env) { const write = await env.WORKSPACE.writeFile('/notes/edit-summary.md', new TextEncoder().encode('cropped square')); if (write.status === 'error') return write; }",
      },
    ]);
    expect(dependencies.sessionFiles["/photos/current"]).toEqual(currentPng);
    expect(dependencies.sessionFiles["/notes/edit-summary.md"]).toEqual(new TextEncoder().encode("cropped square"));
    await expect(controller.listPhotoState()).resolves.toMatchObject({
      files: [{ path: "/notes/edit-summary.md" }, { path: "/photos/current" }],
    });
  });

  it("previews, commits, and clears the draft edit", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      session: { "/photos/current": draftPng },
      draftEditId: "session-1",
    });
    const controller = new PhotoDraftController(dependencies);

    await expect(controller.previewDraft()).resolves.toEqual({
      status: "draft-preview-ready",
      draftEditId: "session-1",
      path: "/photos/current",
      bytes: draftPng.byteLength,
    });

    await expect(controller.commitDraft()).resolves.toEqual({
      status: "current-updated",
      revisionId: "revision-1",
      createdAt: 2,
      message: "Draft edit is now the current version.",
    });
    expect(dependencies.draftEditId).toBeUndefined();
  });

  it("throws away the draft edit without publishing it", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      session: { "/photos/current": draftPng },
      draftEditId: "session-1",
    });
    const controller = new PhotoDraftController(dependencies);

    await expect(controller.discardDraft()).resolves.toEqual({
      status: "draft-discarded",
      message: "Draft edit was thrown away.",
    });
    expect(dependencies.session.discarded).toBe(true);
    expect(dependencies.draftEditId).toBeUndefined();
  });

  it("reads draft images through the active file copy", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      session: { "/photos/current": draftPng },
      draftEditId: "session-1",
    });
    const controller = new PhotoDraftController(dependencies);

    await expect(controller.readDraftImage()).resolves.toEqual({ status: "ok", value: draftPng });
  });

  it("passes shell syntax through to the mounted workspace command runner", async () => {
    const dependencies = createDependencies({ head: { "/photos/original.png": originalPng } });
    const controller = new PhotoDraftController(dependencies);

    await expect(
      controller.runWorkspaceCommand({
        command: "identify /workspace/photos/original.png | tee dimensions.txt && convert /workspace/photos/original.png label:@caption.txt /workspace/photos/current",
      }),
    ).resolves.toMatchObject({ status: "command-completed" });
  });
});

type CreateDependenciesOptions = {
  head: Record<string, Uint8Array>;
  session?: Record<string, Uint8Array>;
  draftEditId?: string;
  commandOutput?: Uint8Array;
};

function createDependencies(options: CreateDependenciesOptions) {
  const workspace = new FakeWorkspace(options.head, options.session ?? {});
  const commandRunner = new FakeWorkspaceCommandRunner(options.commandOutput ?? draftPng);
  const dynamicWorkerRunner = new FakeDynamicWorkerRunner(workspace.session);
  const dependencies = {
    workspaceName: "demo",
    workspaces: { getByName: () => workspace },
    commandRunner,
    dynamicWorkerRunner,
    workspaceForDraft: () => ({}) as never,
    getDraftEditId: () => dependencies.draftEditId,
    setDraftEditId: (draftEditId: string | undefined) => {
      dependencies.draftEditId = draftEditId;
    },
    draftEditId: options.draftEditId,
    workspace,
    session: workspace.session,
    sessionFiles: workspace.session.files,
  };
  return dependencies;
}

class FakeWorkspace {
  readonly session: FakeSession;
  beginSessionCount = 0;

  constructor(
    private readonly headFiles: Record<string, Uint8Array>,
    sessionFiles: Record<string, Uint8Array>,
  ) {
    this.session = new FakeSession(sessionFiles);
  }

  async mkdir(_path: string) {
    return { status: "ok" as const };
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.headFiles[path] = contents;
    return { status: "ok" as const };
  }

  async readFile(path: string) {
    return fileResult(this.headFiles[path], path);
  }

  async delete(path: string) {
    delete this.headFiles[path];
    return { status: "ok" as const };
  }

  async stat(path: string) {
    const value = this.headFiles[path];
    return value
      ? { status: "ok" as const, value: { path, type: "file" as const, size: value.byteLength, createdAt: 1, updatedAt: 1 } }
      : { status: "error" as const, error: pathNotFound(path) };
  }

  async list(path: string) {
    const files = Object.keys(this.headFiles).filter((filePath) => filePath.startsWith(`${path}/`));
    if (files.length === 0) {
      return { status: "error" as const, error: pathNotFound(path) };
    }
    return {
      status: "ok" as const,
      value: files.map((filePath) => ({
        name: filePath.slice(path.length + 1),
        path: filePath,
        type: "file" as const,
      })),
    };
  }

  async beginSession() {
    this.beginSessionCount += 1;
    for (const [path, contents] of Object.entries(this.headFiles)) {
      this.session.files[path] ??= contents;
    }
    return { status: "ok" as const, value: { sessionId: "session-1", createdAt: 1 } };
  }

  async getSession(sessionId: string) {
    if (sessionId !== "session-1") {
      return { status: "error" as const, error: { tag: "SessionNotFoundError" as const, sessionId, message: `Session not found: ${sessionId}` } };
    }
    return { status: "ok" as const, value: { sessionId: "session-1", createdAt: 1 } };
  }

  async sessionMkdir(_sessionId: string, path: string) {
    return this.session.mkdir(path);
  }

  async sessionWriteFile(_sessionId: string, path: string, contents: Uint8Array) {
    return this.session.writeFile(path, contents);
  }

  async sessionWriteTreeBatch(_sessionId: string, root: string, entries: Array<{ path: string; contents: Uint8Array }>) {
    return this.session.writeTree(root, entries);
  }

  async sessionReadFile(_sessionId: string, path: string) {
    return this.session.readFile(path);
  }

  async sessionList(_sessionId: string, path: string) {
    return this.session.list(path);
  }

  async sessionStat(_sessionId: string, path: string) {
    return this.session.stat(path);
  }

  async sessionDelete(_sessionId: string, path: string) {
    return this.session.delete(path);
  }

  async sessionCommit(_sessionId: string) {
    return this.session.commit();
  }

  async sessionDiscard(_sessionId: string) {
    return this.session.discard();
  }
}

class FakeSession {
  discarded = false;
  disposeCount = 0;
  infoCallCount = 0;

  constructor(readonly files: Record<string, Uint8Array>) {}

  async info() {
    this.infoCallCount += 1;
    return { status: "ok" as const, value: { sessionId: "session-1", createdAt: 1 } };
  }

  async readFile(path: string) {
    return fileResult(this.files[path], path);
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.files[path] = contents;
    return { status: "ok" as const };
  }

  async writeTree(root: string, entries: Array<{ path: string; contents: Uint8Array }>) {
    for (const entry of entries) {
      this.files[joinTreePath(root, entry.path)] = entry.contents;
    }
    return { status: "ok" as const };
  }

  async list(path: string) {
    const entries: Record<string, { type: "directory" | "file" }> = { "/": { type: "directory" } };
    for (const filePath of Object.keys(this.files)) {
      const segments = filePath.split("/").filter(Boolean);
      let current = "";
      for (const segment of segments.slice(0, -1)) {
        current = `${current}/${segment}`;
        entries[current] = { type: "directory" };
      }
      entries[filePath] = { type: "file" };
    }

    const entry = entries[path];
    if (!entry) return { status: "error" as const, error: pathNotFound(path) };
    if (entry.type === "file") return { status: "error" as const, error: { tag: "NotDirectoryError" as const, path, message: `Not a directory: ${path}` } };

    const prefix = path === "/" ? "/" : `${path}/`;
    return {
      status: "ok" as const,
      value: Object.entries(entries)
        .filter(([childPath]) => childPath !== path && childPath.startsWith(prefix))
        .filter(([childPath]) => !childPath.slice(prefix.length).includes("/"))
        .map(([childPath, child]) => ({
          name: childPath.split("/").at(-1) ?? "",
          path: childPath,
          type: child.type,
        })),
    };
  }

  async mkdir(_path: string) {
    return { status: "ok" as const };
  }

  async delete(path: string) {
    delete this.files[path];
    return { status: "ok" as const };
  }

  async stat(path: string) {
    const value = this.files[path];
    return value
      ? { status: "ok" as const, value: { path, type: "file" as const, size: value.byteLength, createdAt: 1, updatedAt: 1 } }
      : { status: "error" as const, error: pathNotFound(path) };
  }

  async commit() {
    return { status: "ok" as const, value: { revisionId: "revision-1", createdAt: 2 } };
  }

  async discard() {
    this.discarded = true;
    return { status: "ok" as const };
  }

  [Symbol.dispose]() {
    this.disposeCount += 1;
  }
}

class FakeDynamicWorkerRunner {
  readonly calls: Array<{ code: string }> = [];

  constructor(private readonly session: FakeSession) {}

  async run(options: { code: string }) {
    this.calls.push({ code: options.code });
    await this.session.mkdir("/notes");
    await this.session.writeFile("/notes/edit-summary.md", new TextEncoder().encode("cropped square"));
    return Result.ok({ wrote: "/notes/edit-summary.md" });
  }
}

class FakeWorkspaceCommandRunner {
  readonly calls: Array<{ command: string; root: string; draftEditId: string }> = [];

  constructor(private readonly output: Uint8Array) {}

  async runWorkspaceCommand(options: { files: WorkspaceFileCopyFiles; command: string; root: string; draftEditId: string }) {
    this.calls.push({ command: options.command, root: options.root, draftEditId: options.draftEditId });
    await options.files.write("/photos/current", this.output);
    return {
      command: options.command,
      root: options.root,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      reconcile: {
        created: [],
        modified: ["/photos/current"],
        deleted: [],
        unchanged: 1,
      },
    };
  }
}

function joinTreePath(root: string, path: string): string {
  return root === "/" ? `/${path}` : `${root}/${path}`;
}

function fileResult(value: Uint8Array | undefined, path: string) {
  return value
    ? { status: "ok" as const, value }
    : { status: "error" as const, error: pathNotFound(path) };
}

function pathNotFound(path: string) {
  return {
    tag: "PathNotFoundError" as const,
    path,
    message: `Path not found: ${path}`,
  };
}
