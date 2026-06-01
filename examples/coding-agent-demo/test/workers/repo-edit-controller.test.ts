import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { RepoEditController } from "../../src/repo/edit-controller";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("RepoEditController", () => {
  it("runs Dynamic Worker code against an active edit copy", async () => {
    const { controller, workspace, runner, getEditCopyId } = await setupEditController();

    const result = await controller.runDynamicWorker({ code: "export default async function(env) {}" });
    const currentRead = await workspace.files.read("/notes/edit.md");
    const edit = await workspace.files.getCopy(getEditCopyId()!);
    if (Result.isError(edit)) throw new Error("edit copy missing");
    const editRead = await edit.value.files.read("/notes/edit.md");

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("edit failed");
    expect(result.value).toEqual({
      status: "dynamic-worker-completed",
      editCopyId: getEditCopyId(),
      result: { wrote: "/notes/edit.md" },
    });
    expect(runner.calls).toEqual([{ code: "export default async function(env) {}" }]);
    expect(Result.isError(currentRead)).toBe(true);
    expect(Result.isOk(editRead)).toBe(true);
    if (Result.isOk(editRead)) {
      expect(decoder.decode(editRead.value)).toBe("read # Repo");
    }
  });

  it("applies the active edit copy to current Workspace files", async () => {
    const { controller, workspace, getEditCopyId } = await setupEditController();
    await controller.runDynamicWorker({ code: "export default async function(env) {}" });
    const editCopyId = getEditCopyId();

    const result = await controller.applyEdit();
    const currentRead = await workspace.files.read("/notes/edit.md");

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("apply failed");
    expect(result.value).toMatchObject({ status: "edit-applied", editCopyId });
    expect(result.value.revisionId).toEqual(expect.any(String));
    expect(getEditCopyId()).toBeUndefined();
    expect(Result.isOk(currentRead)).toBe(true);
    if (Result.isOk(currentRead)) {
      expect(decoder.decode(currentRead.value)).toBe("read # Repo");
    }
  });

  it("discards the active edit copy without changing current Workspace files", async () => {
    const { controller, workspace, getEditCopyId } = await setupEditController();
    await controller.runDynamicWorker({ code: "export default async function(env) {}" });
    const editCopyId = getEditCopyId();

    const result = await controller.discardEdit();
    const currentRead = await workspace.files.read("/notes/edit.md");

    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) throw new Error("discard failed");
    expect(result.value).toEqual({ status: "edit-discarded", editCopyId });
    expect(getEditCopyId()).toBeUndefined();
    expect(Result.isError(currentRead)).toBe(true);
  });

  it("returns a value error when applying without an active edit copy", async () => {
    const { controller } = await setupEditController();

    const result = await controller.applyEdit();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({
        tag: "NoActiveRepoEditError",
        message: "There is no active repo edit to apply.",
      });
    }
  });

  it("clears stale edit copy state when applying a missing copy", async () => {
    const { controller, setEditCopyId, getEditCopyId } = await setupEditController();
    setEditCopyId("missing-copy");

    const result = await controller.applyEdit();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.tag).toBe("SessionNotFoundError");
    }
    expect(getEditCopyId()).toBeUndefined();
  });

  it("returns a value error when discarding without an active edit copy", async () => {
    const { controller } = await setupEditController();

    const result = await controller.discardEdit();

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({
        tag: "NoActiveRepoEditError",
        message: "There is no active repo edit to discard.",
      });
    }
  });
});

async function setupEditController() {
  const workspaceName = `repo-edit-${crypto.randomUUID()}`;
  const workspace = Workspace.get(env.WORKSPACES, workspaceName);
  const seed = await workspace.files.copy("seed");
  if (Result.isError(seed)) throw new Error("seed copy failed");
  await seed.value.files.writeTree("/", [
    { path: "README.md", contents: encoder.encode("# Repo") },
  ]);
  await seed.value.apply();

  let editCopyId: string | undefined;
  const runner = {
    calls: [] as Array<{ code: string }>,
    async run(options: { code: string }) {
      this.calls.push({ code: options.code });
      const copy = await workspace.files.getCopy(editCopyId!);
      if (Result.isError(copy)) return Result.err({ tag: "WorkspaceDynamicWorkerExecutionError" as const, message: copy.error.tag });
      const readme = await copy.value.files.read("/README.md");
      if (Result.isError(readme)) return Result.err({ tag: "WorkspaceDynamicWorkerExecutionError" as const, message: readme.error.tag });
      await copy.value.files.mkdir("/notes");
      await copy.value.files.write("/notes/edit.md", encoder.encode(`read ${decoder.decode(readme.value)}`));
      return Result.ok({ wrote: "/notes/edit.md" });
    },
  };
  const controller = new RepoEditController({
    workspaces: env.WORKSPACES,
    workspaceName,
    dynamicWorkerRunner: runner,
    workspaceForEdit: () => ({}) as never,
    getEditCopyId: () => editCopyId,
    setEditCopyId: (next) => { editCopyId = next; },
  });

  return {
    controller,
    workspace,
    runner,
    getEditCopyId: () => editCopyId,
    setEditCopyId: (next: string | undefined) => { editCopyId = next; },
  };
}
