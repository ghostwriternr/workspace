import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace, type WorkspaceCopyFiles } from "@cloudflare/workspace";
import type { WorkspaceDynamicWorkerFileCapability } from "@cloudflare/workspace-adapter-dynamic-worker";

import { PhotoDraftController } from "../../src/photo/draft-controller";
import { createFakeArtifactsWorkspace, type FakeArtifactsWorkspaceDriver } from "../fake-artifacts-workspace";

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
      draftEditId: dependencies.draftEditId,
      message: "Draft edit is ready.",
    });
    expect(state).toMatchObject({
      workspaceName: "demo",
      original: { exists: true, path: "/photos/original.png", bytes: originalPng.byteLength },
      current: { exists: false },
      draft: { exists: false, draftEditId: dependencies.draftEditId },
    });
    expect(state.files.map((file) => file.path)).toEqual(["/notes/edit-summary.md", "/photos/original.png"]);
  });

  it("runs commands with the draft mounted and captures changes explicitly", async () => {
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
    });
    expect(dependencies.driver.file(dependencies.draftEditId!, "/photos/current")).toBeUndefined();

    const captured = await controller.captureDraft();

    expect(captured).toEqual({
      status: "draft-captured",
      capture: { path: "/workspace", stdout: "captured", stderr: "" },
    });
    expect(dependencies.driver.file(dependencies.draftEditId!, "/photos/current")).toEqual(draftPng);
    expect(dependencies.sandbox.commands).toEqual([
      expect.objectContaining({ command: "workspace-mount" }),
      {
        command: "identify /workspace/photos/original.png && convert /workspace/photos/original.png /workspace/photos/current",
        options: { cwd: "/workspace" },
      },
      expect.objectContaining({ command: "workspace-mount" }),
      expect.objectContaining({ command: "workspace-capture" }),
    ]);
  });

  it("reuses the existing draft for follow-up workspace commands", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      copy: { "/photos/current": currentPng },
      draftEditId: "copy-1",
      commandOutput: draftPng,
    });
    const controller = new PhotoDraftController(dependencies);

    await controller.runWorkspaceCommand({
      command: "convert /workspace/photos/current -resize 512x512^ /workspace/photos/current",
    });

    expect(dependencies.sandbox.commands).toEqual([
      expect.objectContaining({ command: "workspace-mount" }),
      {
        command: "convert /workspace/photos/current -resize 512x512^ /workspace/photos/current",
        options: { cwd: "/workspace" },
      },
    ]);
    expect(dependencies.driver.file("copy-1", "/photos/current")).toEqual(currentPng);
  });

  it("runs Dynamic Worker code against the same draft working copy", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      copy: { "/photos/current": currentPng },
      draftEditId: "copy-1",
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
    expect(dependencies.dynamicWorkerRunner.calls).toEqual([
      {
        code: "export default async function(env) { const write = await env.WORKSPACE.writeFile('/notes/edit-summary.md', new TextEncoder().encode('cropped square')); if (write.status === 'error') return write; }",
      },
    ]);
    expect(dependencies.driver.file("copy-1", "/photos/current")).toEqual(currentPng);
    expect(dependencies.driver.file("copy-1", "/notes/edit-summary.md")).toEqual(new TextEncoder().encode("cropped square"));
    await expect(controller.listPhotoState()).resolves.toMatchObject({
      files: [{ path: "/notes/edit-summary.md" }, { path: "/photos/current" }],
    });
  });

  it("previews, commits, and clears the draft edit", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      copy: { "/photos/current": draftPng },
      draftEditId: "copy-1",
    });
    const controller = new PhotoDraftController(dependencies);

    await expect(controller.previewDraft()).resolves.toEqual({
      status: "draft-preview-ready",
      draftEditId: "copy-1",
      path: "/photos/current",
      bytes: draftPng.byteLength,
    });

    await expect(controller.commitDraft()).resolves.toEqual({
      status: "current-updated",
      revisionId: "revision-copy-1",
      createdAt: 1,
      message: "Draft edit is now the current version.",
    });
    expect(dependencies.draftEditId).toBeUndefined();
    expect(dependencies.driver.file("demo", "/photos/current")).toEqual(draftPng);
  });

  it("throws away the draft edit without publishing it", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      copy: { "/photos/current": draftPng },
      draftEditId: "copy-1",
    });
    const controller = new PhotoDraftController(dependencies);

    await expect(controller.discardDraft()).resolves.toEqual({
      status: "draft-discarded",
      message: "Draft edit was thrown away.",
    });
    expect(dependencies.driver.hasRepository("copy-1")).toBe(false);
    expect(dependencies.draftEditId).toBeUndefined();
  });

  it("reads draft images through the active working copy", async () => {
    const dependencies = createDependencies({
      head: { "/photos/original.png": originalPng },
      copy: { "/photos/current": draftPng },
      draftEditId: "copy-1",
    });
    const controller = new PhotoDraftController(dependencies);

    await expect(controller.readDraftImage()).resolves.toEqual({ status: "ok", value: draftPng });
  });

  it("passes shell syntax through to the mounted workspace", async () => {
    const dependencies = createDependencies({ head: { "/photos/original.png": originalPng } });
    const controller = new PhotoDraftController(dependencies);

    await expect(
      controller.runWorkspaceCommand({
        command: "identify /workspace/photos/original.png | tee dimensions.txt && convert /workspace/photos/original.png label:@caption.txt /workspace/photos/current",
      }),
    ).resolves.toMatchObject({ status: "command-completed" });
  });

  it("returns command and Dynamic Worker errors as values", async () => {
    const commandDependencies = createDependencies({ head: { "/photos/original.png": originalPng }, commandError: "mount failed" });
    const commandController = new PhotoDraftController(commandDependencies);

    await expect(commandController.runWorkspaceCommand({ command: "identify /workspace/photos/original.png" })).resolves.toMatchObject({
      status: "error",
      error: { tag: "WorkspaceSandboxAttachError", message: "mount failed" },
    });

    const workerDependencies = createDependencies({ head: { "/photos/original.png": originalPng }, dynamicWorkerError: "worker failed" });
    const workerController = new PhotoDraftController(workerDependencies);

    await expect(workerController.runDynamicWorker({ code: "export default async function() {}" })).resolves.toEqual({
      status: "error",
      error: { tag: "WorkspaceDynamicWorkerExecutionError", message: "worker failed" },
    });
  });
});

type CreateDependenciesOptions = {
  head: Record<string, Uint8Array>;
  copy?: Record<string, Uint8Array>;
  draftEditId?: string;
  commandOutput?: Uint8Array;
  commandError?: string;
  dynamicWorkerError?: string;
};

type TestDependencies = ConstructorParameters<typeof PhotoDraftController>[0] & {
  draftEditId?: string;
  driver: FakeArtifactsWorkspaceDriver;
  sandbox: FakeSandbox;
  dynamicWorkerRunner: FakeDynamicWorkerRunner;
};

function createDependencies(options: CreateDependenciesOptions): TestDependencies {
  const { artifacts, driver, object } = createFakeArtifactsWorkspace({ demo: options.head });
  if (options.draftEditId) {
    driver.seedWorkingCopy("demo", options.draftEditId, options.copy ?? {});
  }
  void object.recordCurrentRepository({
    repository: "demo",
    remote: "https://git.example/demo.git",
    defaultBranch: "main",
  });
  if (options.draftEditId) {
    void object.recordCopy({
      copyId: options.draftEditId,
      createdAt: 100,
      baseRevisionId: "revision-demo-0",
    });
  }
  const workspace = Workspace.bind({ artifacts, objects: { getByName: () => object } }).get("demo");
  let draftEditId = options.draftEditId;
  const sandbox = new FakeSandbox(workspace, () => draftEditId, options.commandOutput ?? draftPng, options.commandError);

  return {
    workspaceName: "demo",
    workspace,
    sandboxForDraft: () => sandbox,
    dynamicWorkerRunner: new FakeDynamicWorkerRunner(() => draftFiles(workspace, draftEditId), options.dynamicWorkerError),
    workspaceForDraft: () => ({}) as WorkspaceDynamicWorkerFileCapability,
    getDraftEditId: () => draftEditId,
    setDraftEditId: (nextDraftEditId: string | undefined) => {
      draftEditId = nextDraftEditId;
    },
    get draftEditId() {
      return draftEditId;
    },
    driver,
    sandbox,
  } satisfies TestDependencies;
}

async function draftFiles(workspace: Workspace, draftEditId: string | undefined): Promise<WorkspaceCopyFiles> {
  if (!draftEditId) throw new Error("No draft edit exists.");
  const copy = await workspace.copies.get(draftEditId);
  if (Result.isError(copy)) throw new Error(`Draft edit not found: ${draftEditId}`);
  return copy.value.files;
}

class FakeDynamicWorkerRunner {
  readonly calls: Array<{ code: string }> = [];

  constructor(
    private readonly getFiles: () => Promise<WorkspaceCopyFiles>,
    private readonly error?: string,
  ) {}

  async run(options: { code: string }) {
    this.calls.push({ code: options.code });
    if (this.error) {
      return Result.err({ tag: "WorkspaceDynamicWorkerExecutionError" as const, message: this.error });
    }

    const files = await this.getFiles();
    await files.mkdir("/notes");
    await files.write("/notes/edit-summary.md", new TextEncoder().encode("cropped square"));
    return Result.ok({ wrote: "/notes/edit-summary.md" });
  }
}

class FakeSandbox {
  readonly commands: Array<{ command: string; options: { cwd?: string; env?: Record<string, string> } | undefined }> = [];

  constructor(
    private readonly workspace: Workspace,
    private readonly getDraftEditId: () => string | undefined,
    private readonly output: Uint8Array,
    private readonly error?: string,
  ) {}

  async exec(command: string, options?: { cwd?: string; env?: Record<string, string> }) {
    this.commands.push({ command, options });
    if (this.error && command === "workspace-mount") {
      return { success: false, exitCode: 1, stdout: "", stderr: this.error };
    }
    if (command === "workspace-capture") {
      const copy = await this.workspace.copies.get(this.getDraftEditId() ?? "");
      if (Result.isError(copy)) throw new Error("draft not found");
      await copy.value.files.write("/photos/current", this.output);
      return { success: true, exitCode: 0, stdout: "captured", stderr: "" };
    }
    return { success: true, exitCode: 0, stdout: "ok", stderr: "" };
  }
}
