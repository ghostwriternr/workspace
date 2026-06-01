import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { RepoStateController } from "../../src/repo/state-controller";

const encoder = new TextEncoder();

describe("RepoStateController", () => {
  it("lists current Workspace files recursively for repo state", async () => {
    const workspaceName = `repo-state-${crypto.randomUUID()}`;
    const workspace = Workspace.get(env.WORKSPACES, workspaceName);
    const copy = await workspace.files.copy("seed");
    if (Result.isError(copy)) throw new Error("copy failed");

    await copy.value.files.writeTree("/", [
      { path: "README.md", contents: encoder.encode("# Repo") },
      { path: "src/index.ts", contents: encoder.encode("export {};") },
      { path: "src/lib/util.ts", contents: encoder.encode("export const util = true;") },
    ]);
    await copy.value.apply();

    const state = await new RepoStateController({ workspaces: env.WORKSPACES, workspaceName }).listRepoState();

    expect(state).toEqual({
      workspaceName,
      files: [
        { path: "/README.md", type: "file", size: 6 },
        { path: "/src", type: "directory", size: null },
        { path: "/src/index.ts", type: "file", size: 10 },
        { path: "/src/lib", type: "directory", size: null },
        { path: "/src/lib/util.ts", type: "file", size: 25 },
      ],
    });
  });

  it("lists files from an active edit copy", async () => {
    const workspaceName = `repo-state-edit-${crypto.randomUUID()}`;
    const workspace = Workspace.get(env.WORKSPACES, workspaceName);
    const seed = await workspace.files.copy("seed");
    if (Result.isError(seed)) throw new Error("seed copy failed");

    await seed.value.files.writeTree("/", [
      { path: "README.md", contents: encoder.encode("# Repo") },
    ]);
    await seed.value.apply();

    const edit = await workspace.files.copy("edit");
    if (Result.isError(edit)) throw new Error("edit copy failed");
    await edit.value.files.write("/notes.md", encoder.encode("draft note"));

    const state = await new RepoStateController({
      workspaces: env.WORKSPACES,
      workspaceName,
      editCopyId: edit.value.id,
    }).listRepoState();

    expect(state).toEqual({
      workspaceName,
      editCopyId: edit.value.id,
      files: [
        { path: "/README.md", type: "file", size: 6 },
        { path: "/notes.md", type: "file", size: 10 },
      ],
    });
  });
});
