import { env } from "cloudflare:workers";
import { Result, type Result as BetterResult } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { RepoEditController } from "../../src/repo/edit-controller";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("RepoEditController", () => {
  it("reads current files and directories without opening an edit copy", async () => {
    const { controller, getEditCopyId } = await setupEditController();

    expect(await expectOk(controller.read({ path: "/README.md" }))).toEqual({
      status: "file-read",
      path: "/README.md",
      contents: "# Repo",
    });
    expect(await expectOk(controller.read({ path: "/" }))).toMatchObject({
      status: "directory-listed",
      path: "/",
      entries: [{ path: "/README.md", type: "file" }],
    });
    expect(getEditCopyId()).toBeUndefined();
  });

  it("writes and edits files in an active edit copy", async () => {
    const { controller, workspace, getEditCopyId } = await setupEditController();

    expect(await expectOk(controller.write({ path: "/notes/todo.md", contents: "hello world" }))).toMatchObject({
      status: "file-written",
      path: "/notes/todo.md",
    });
    expect(await expectOk(controller.edit({ path: "/notes/todo.md", oldText: "world", newText: "Workspace" }))).toMatchObject({
      status: "file-edited",
      path: "/notes/todo.md",
      replacements: 1,
    });

    const current = await workspace.files.read("/notes/todo.md");
    const copy = unwrap(await workspace.files.getCopy(getEditCopyId()!));
    const edited = unwrap(await copy.files.read("/notes/todo.md"));

    expect(Result.isError(current)).toBe(true);
    expect(decoder.decode(edited)).toBe("hello Workspace");
  });

  it("treats exact edit replacement text literally", async () => {
    const { controller, workspace, getEditCopyId } = await setupEditController();
    await expectOk(controller.write({ path: "/scripts/example.sh", contents: "echo old\n" }));

    await expectOk(controller.edit({ path: "/scripts/example.sh", oldText: "old", newText: "$HOME and $&" }));

    const copy = unwrap(await workspace.files.getCopy(getEditCopyId()!));
    expect(decoder.decode(unwrap(await copy.files.read("/scripts/example.sh")))).toBe("echo $HOME and $&\n");
  });

  it("rejects exact edits that do not identify one replacement", async () => {
    const { controller } = await setupEditController();
    await expectOk(controller.write({ path: "/notes/repeated.md", contents: "same same" }));

    expect(await expectError(controller.edit({ path: "/notes/repeated.md", oldText: "missing", newText: "x" }))).toMatchObject({
      tag: "TextNotFoundError",
      path: "/notes/repeated.md",
    });
    expect(await expectError(controller.edit({ path: "/notes/repeated.md", oldText: "same", newText: "x" }))).toMatchObject({
      tag: "AmbiguousTextEditError",
      path: "/notes/repeated.md",
      matches: 2,
    });
  });

  it("runs Worker code against the active edit copy", async () => {
    const { controller, workspace, runner, getEditCopyId } = await setupEditController();

    expect(await expectOk(controller.run({ code: "export default async function(env) {}" }))).toEqual({
      status: "run-completed",
      editCopyId: getEditCopyId(),
      result: { wrote: "/notes/edit.md" },
    });

    const current = await workspace.files.read("/notes/edit.md");
    const copy = unwrap(await workspace.files.getCopy(getEditCopyId()!));
    const edited = unwrap(await copy.files.read("/notes/edit.md"));

    expect(runner.calls).toEqual([{ code: "export default async function(env) {}" }]);
    expect(Result.isError(current)).toBe(true);
    expect(decoder.decode(edited)).toBe("read # Repo");
  });

  it("applies or discards only an active edit copy", async () => {
    const applySetup = await setupEditController();
    expect(await expectOk(applySetup.controller.write({ path: "/notes/apply.md", contents: "apply me" }))).toMatchObject({ status: "file-written" });
    const applied = await expectOk(applySetup.controller.applyEdit());

    expect(applied).toMatchObject({ status: "edit-applied", editCopyId: expect.any(String), revisionId: expect.any(String) });
    expect(applySetup.getEditCopyId()).toBeUndefined();
    expect(decoder.decode(unwrap(await applySetup.workspace.files.read("/notes/apply.md")))).toBe("apply me");

    const discardSetup = await setupEditController();
    expect(await expectOk(discardSetup.controller.write({ path: "/notes/discard.md", contents: "discard me" }))).toMatchObject({ status: "file-written" });
    const discarded = await expectOk(discardSetup.controller.discardEdit());

    expect(discarded).toMatchObject({ status: "edit-discarded", editCopyId: expect.any(String) });
    expect(discardSetup.getEditCopyId()).toBeUndefined();
    expect(Result.isError(await discardSetup.workspace.files.read("/notes/discard.md"))).toBe(true);
  });

  it.each(["apply", "discard"] as const)("returns a value error when %sing without an active edit copy", async (action) => {
    const { controller } = await setupEditController();

    if (action === "apply") {
      await expectNoActiveEdit(controller.applyEdit(), action);
    } else {
      await expectNoActiveEdit(controller.discardEdit(), action);
    }
  });
});

async function setupEditController() {
  const workspaceName = `repo-edit-${crypto.randomUUID()}`;
  const workspace = Workspace.get(env.WORKSPACES, workspaceName);
  const seed = unwrap(await workspace.files.copy("seed"));
  await seed.files.writeTree("/", [
    { path: "README.md", contents: encoder.encode("# Repo") },
  ]);
  await seed.apply();

  let editCopyId: string | undefined;
  const runner = {
    calls: [] as Array<{ code: string }>,
    async run(options: { code: string }) {
      this.calls.push({ code: options.code });
      const copy = unwrap(await workspace.files.getCopy(editCopyId!));
      const readme = unwrap(await copy.files.read("/README.md"));
      await copy.files.writeTree("/", [
        { path: "notes/edit.md", contents: encoder.encode(`read ${decoder.decode(readme)}`) },
      ]);
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
  };
}

function unwrap<T, E>(result: BetterResult<T, E>): T {
  if (Result.isError(result)) {
    throw new Error(`Expected ok result, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

async function expectOk<T, E>(promise: Promise<BetterResult<T, E>>): Promise<T> {
  return unwrap(await promise);
}

async function expectError<T, E>(promise: Promise<BetterResult<T, E>>): Promise<E> {
  const result = await promise;
  if (Result.isOk(result)) {
    throw new Error(`Expected error result, got ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

async function expectNoActiveEdit<T>(promise: Promise<BetterResult<T, { tag: string; message: string }>>, action: "apply" | "discard") {
  expect(await expectError(promise)).toEqual({
    tag: "NoActiveRepoEditError",
    message: `There is no active repo edit to ${action}.`,
  });
}
