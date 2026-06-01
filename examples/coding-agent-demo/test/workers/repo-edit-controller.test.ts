import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { RepoEditController } from "../../src/repo/edit-controller";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("RepoEditController", () => {
  it("runs Dynamic Worker code against an active edit copy", async () => {
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
      calls: [] as Array<{ editCopyId: string; code: string }>,
      async runDynamicWorker(options: { editCopyId: string; code: string }) {
        this.calls.push(options);
        const copy = await workspace.files.getCopy(options.editCopyId);
        if (Result.isError(copy)) throw new Error(copy.error.tag);
        const readme = await copy.value.files.read("/README.md");
        if (Result.isError(readme)) throw new Error(readme.error.tag);
        await copy.value.files.mkdir("/notes");
        await copy.value.files.write("/notes/edit.md", encoder.encode(`read ${decoder.decode(readme.value)}`));
        return { wrote: "/notes/edit.md" };
      },
    };
    const controller = new RepoEditController({
      workspaces: env.WORKSPACES,
      workspaceName,
      dynamicWorkerRunner: runner,
      getEditCopyId: () => editCopyId,
      setEditCopyId: (next) => { editCopyId = next; },
    });

    const result = await controller.runDynamicWorker({ code: "export default async function(env) {}" });
    const currentRead = await workspace.files.read("/notes/edit.md");
    const edit = await workspace.files.getCopy(editCopyId!);
    if (Result.isError(edit)) throw new Error("edit copy missing");
    const editRead = await edit.value.files.read("/notes/edit.md");

    expect(result).toEqual({
      status: "dynamic-worker-completed",
      editCopyId,
      result: { wrote: "/notes/edit.md" },
    });
    expect(runner.calls).toEqual([{ editCopyId, code: "export default async function(env) {}" }]);
    expect(Result.isError(currentRead)).toBe(true);
    expect(Result.isOk(editRead)).toBe(true);
    if (Result.isOk(editRead)) {
      expect(decoder.decode(editRead.value)).toBe("read # Repo");
    }
  });
});
