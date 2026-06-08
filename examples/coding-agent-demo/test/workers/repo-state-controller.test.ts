import { Result } from "better-result";
import { afterEach, describe, expect, it } from "vitest";

import { RepoStateController } from "../../src/repo/state-controller";
import { createFakeArtifactsWorkspace, resetFakeArtifactsWorkspace } from "./fake-artifacts-workspace";

const encoder = new TextEncoder();

describe("RepoStateController", () => {
  afterEach(() => {
    resetFakeArtifactsWorkspace();
  });

  it("lists current Workspace files recursively for repo state", async () => {
    const { workspace, workspaceName } = createFakeArtifactsWorkspace({
      "/README.md": encoder.encode("# Repo"),
      "/src/index.ts": encoder.encode("export {};"),
      "/src/lib/util.ts": encoder.encode("export const util = true;"),
    });

    const state = await new RepoStateController({ workspace, workspaceName }).listRepoState();

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
    const { workspace, workspaceName } = createFakeArtifactsWorkspace({
      "/README.md": encoder.encode("# Repo"),
    });

    const working = await workspace.files.copy("working");
    if (Result.isError(working)) throw new Error("working copy failed");
    await working.value.files.write("/notes.md", encoder.encode("draft note"));

    const state = await new RepoStateController({
      workspace,
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
    const { workspace, workspaceName } = createFakeArtifactsWorkspace();
    const state = await new RepoStateController({
      workspace,
      workspaceName,
      workingCopyId: "missing-copy",
    }).listRepoState();

    expect(Result.isError(state)).toBe(true);
    if (Result.isError(state)) {
      expect(state.error.tag).toBe("SessionNotFoundError");
    }
  });
});
