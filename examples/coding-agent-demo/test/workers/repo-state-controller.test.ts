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

    expect(Result.isOk(state)).toBe(true);
    if (Result.isError(state)) throw new Error("repo state failed");
    expect(state.value).toEqual({
      workspaceName,
      files: [
        { path: "/README.md", type: "file" },
        { path: "/src", type: "directory" },
        { path: "/src/index.ts", type: "file" },
        { path: "/src/lib", type: "directory" },
        { path: "/src/lib/util.ts", type: "file" },
      ],
    });
  });

  it("lists files from an active working copy", async () => {
    const workspaceName = `repo-state-working-${crypto.randomUUID()}`;
    const workspace = Workspace.get(env.WORKSPACES, workspaceName);
    const seed = await workspace.files.copy("seed");
    if (Result.isError(seed)) throw new Error("seed copy failed");

    await seed.value.files.writeTree("/", [
      { path: "README.md", contents: encoder.encode("# Repo") },
    ]);
    await seed.value.apply();

    const working = await workspace.files.copy("working");
    if (Result.isError(working)) throw new Error("working copy failed");
    await working.value.files.write("/notes.md", encoder.encode("draft note"));

    const state = await new RepoStateController({
      workspaces: env.WORKSPACES,
      workspaceName,
      workingCopyId: working.value.id,
    }).listRepoState();

    expect(Result.isOk(state)).toBe(true);
    if (Result.isError(state)) throw new Error("repo state failed");
    expect(state.value).toEqual({
      workspaceName,
      workingCopyId: working.value.id,
      files: [
        { path: "/README.md", type: "file" },
        { path: "/notes.md", type: "file" },
      ],
    });
  });

  it("returns a value error when an active working copy is missing", async () => {
    const state = await new RepoStateController({
      workspaces: env.WORKSPACES,
      workspaceName: `repo-state-missing-working-${crypto.randomUUID()}`,
      workingCopyId: "missing-copy",
    }).listRepoState();

    expect(Result.isError(state)).toBe(true);
    if (Result.isError(state)) {
      expect(state.error.tag).toBe("SessionNotFoundError");
    }
  });
});
