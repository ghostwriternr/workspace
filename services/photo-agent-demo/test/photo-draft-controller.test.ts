import { describe, expect, it } from "vitest";

import { PhotoDraftController } from "../src/photo-draft-controller";

const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const currentPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);
const draftPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3]);

describe("PhotoDraftController", () => {
  it("starts a durable draft edit and reports passive photo state", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
    });
    const controller = new PhotoDraftController(dependencies);

    const draft = await controller.startDraft();
    const state = await controller.listPhotoState();

    expect(dependencies.session.disposeCount).toBe(1);
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
  });

  it("runs freeform sandbox commands without importing a draft image", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
    });
    const controller = new PhotoDraftController(dependencies);

    const result = await controller.runSandboxCommand({
      command: "identify original.png && convert original.png -colorspace Gray square.png",
    });

    expect(result).toEqual({
      status: "command-completed",
      inputPath: "/photos/original.png",
      inputFilename: "original.png",
      command: "identify original.png && convert original.png -colorspace Gray square.png",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
    expect(dependencies.workspace.beginSessionCount).toBe(0);
    expect(dependencies.sessionFiles["/photos/current"]).toBeUndefined();
    expect(dependencies.imageEditor.edits).toEqual([
      {
        input: originalPng,
        inputFilename: "original.png",
        command: "identify original.png && convert original.png -colorspace Gray square.png",
      },
    ]);
  });

  it("imports a sandbox file into the Workspace draft when the agent chooses it", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      sandboxFiles: { "square.png": draftPng },
    });
    const controller = new PhotoDraftController(dependencies);

    const result = await controller.saveDraftFromSandboxFile({ filename: "square.png" });

    expect(result).toEqual({
      status: "draft-updated",
      draftPath: "/photos/current",
      filename: "square.png",
      outputBytes: draftPng.byteLength,
    });
    expect(dependencies.sessionFiles["/photos/current"]).toEqual(draftPng);
    expect(dependencies.imageEditor.reads).toEqual(["square.png"]);
  });

  it("hydrates the existing draft as input for follow-up sandbox commands", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      session: { "/photos/current": currentPng },
      draftEditId: "session-1",
    });
    const controller = new PhotoDraftController(dependencies);

    const result = await controller.runSandboxCommand({
      command: "convert current -resize 512x512^ square.png",
    });

    expect(result.inputPath).toBe("/photos/current");
    expect(result.inputFilename).toBe("current");
    expect(dependencies.imageEditor.edits).toEqual([
      {
        input: currentPng,
        inputFilename: "current",
        command: "convert current -resize 512x512^ square.png",
      },
    ]);
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

  it("disposes session lookup results when reading draft images", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      session: { "/photos/current": draftPng },
      draftEditId: "session-1",
    });
    const controller = new PhotoDraftController(dependencies);

    await expect(controller.readDraftImage()).resolves.toEqual({ status: "ok", value: draftPng });

    expect(dependencies.workspace.getSessionResultDisposeCount).toBe(1);
  });

  it("passes shell syntax through to the sandbox", async () => {
    const dependencies = createDependencies({ head: { "/photos/original.png": originalPng } });
    const controller = new PhotoDraftController(dependencies);

    await expect(
      controller.runSandboxCommand({
        command: "identify original.png | tee dimensions.txt && convert original.png label:@caption.txt square.png",
      }),
    ).resolves.toMatchObject({ status: "command-completed" });
  });
});

type CreateDependenciesOptions = {
  head: Record<string, Uint8Array>;
  session?: Record<string, Uint8Array>;
  sandboxFiles?: Record<string, Uint8Array>;
  draftEditId?: string;
};

function createDependencies(options: CreateDependenciesOptions) {
  const workspace = new FakeWorkspace(options.head, options.session ?? {});
  const imageEditor = new FakeImageEditor(options.sandboxFiles ?? {});
  const dependencies = {
    workspaceName: "demo",
    workspaces: { getByName: () => workspace },
    imageEditor,
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
  getSessionResultDisposeCount = 0;

  constructor(
    private readonly headFiles: Record<string, Uint8Array>,
    sessionFiles: Record<string, Uint8Array>,
  ) {
    this.session = new FakeSession(sessionFiles);
  }

  async readFile(path: string) {
    return fileResult(this.headFiles[path]);
  }

  async stat(path: string) {
    const value = this.headFiles[path];
    return value
      ? { status: "ok" as const, value: { path, type: "file" as const, size: value.byteLength, createdAt: 1, updatedAt: 1 } }
      : { status: "error" as const, error: { tag: "PathNotFoundError" } };
  }

  async list(path: string) {
    expect(path).toBe("/photos");
    return {
      status: "ok" as const,
      value: Object.keys(this.headFiles).map((filePath) => ({
        name: filePath.slice("/photos/".length),
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
    return this.session;
  }

  async getSession(sessionId: string) {
    if (sessionId !== "session-1") {
      return { status: "error" as const, error: { tag: "SessionNotFoundError" } };
    }
    return {
      status: "ok" as const,
      value: this.session,
      [Symbol.dispose]: () => {
        this.getSessionResultDisposeCount += 1;
      },
    };
  }
}

class FakeSession {
  discarded = false;
  disposeCount = 0;

  constructor(readonly files: Record<string, Uint8Array>) {}

  async info() {
    return { status: "ok" as const, value: { sessionId: "session-1", createdAt: 1 } };
  }

  async readFile(path: string) {
    return fileResult(this.files[path]);
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.files[path] = contents;
    return { status: "ok" as const };
  }

  async stat(path: string) {
    const value = this.files[path];
    return value
      ? { status: "ok" as const, value: { path, type: "file" as const, size: value.byteLength, createdAt: 1, updatedAt: 1 } }
      : { status: "error" as const, error: { tag: "PathNotFoundError" } };
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

class FakeImageEditor {
  readonly edits: Array<{ input: Uint8Array; inputFilename: string; command: string }> = [];
  readonly reads: string[] = [];

  constructor(private readonly files: Record<string, Uint8Array>) {}

  async runSandboxCommand(edit: { input: Uint8Array; inputFilename: string; command: string }) {
    this.edits.push(edit);
    return {
      command: edit.command,
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    };
  }

  async readSandboxFile(filename: string) {
    this.reads.push(filename);
    const contents = this.files[filename];
    if (!contents) {
      throw new Error(`missing fake sandbox file: ${filename}`);
    }
    return contents;
  }
}

function fileResult(value: Uint8Array | undefined) {
  return value
    ? { status: "ok" as const, value }
    : { status: "error" as const, error: { tag: "PathNotFoundError" } };
}
