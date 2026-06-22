import { Result } from "better-result";
import { afterEach, describe, expect, it } from "vitest";

import { RepoStateController } from "../../src/repo/state-controller";
import { createFakeArtifactsWorkspace, resetFakeArtifactsWorkspace } from "./fake-artifacts-workspace";

const encoder = new TextEncoder();

describe("RepoStateController", () => {
  afterEach(() => {
    resetFakeArtifactsWorkspace();
  });

  it("returns repo metadata without listing repository files", async () => {
    const { workspace, workspaceName } = createFakeArtifactsWorkspace({
      "/README.md": encoder.encode("# Repo"),
      "/src/index.ts": encoder.encode("export {};"),
    });

    const state = await new RepoStateController({ workspace, workspaceName }).getRepoState();

    expect(Result.isOk(state)).toBe(true);
    if (Result.isError(state)) throw new Error("repo state failed");
    expect(state.value).toEqual({ workspaceName });
  });

  it("lists only direct children for a current Workspace directory", async () => {
    const { workspace, workspaceName } = createFakeArtifactsWorkspace({
      "/README.md": encoder.encode("# Repo"),
      "/src/index.ts": encoder.encode("export {};"),
      "/src/lib/util.ts": encoder.encode("export const util = true;"),
    });

    const listed = await new RepoStateController({ workspace, workspaceName }).listDirectory({ path: "/" });

    expect(Result.isOk(listed)).toBe(true);
    if (Result.isError(listed)) throw new Error("directory listing failed");
    expect(listed.value).toEqual({
      workspaceName,
      path: "/",
      entries: [
        { name: "README.md", path: "/README.md", type: "file" },
        { name: "src", path: "/src", type: "directory" },
      ],
    });
  });

  it("lists direct children from an active working copy", async () => {
    const { workspace, workspaceName } = createFakeArtifactsWorkspace({
      "/README.md": encoder.encode("# Repo"),
    });

    const working = await workspace.copies.create({ label: "working" });
    if (Result.isError(working)) throw new Error("working copy failed");
    await working.value.files.write("/notes.md", encoder.encode("draft note"));
    await working.value.files.write("/src/index.ts", encoder.encode("export {};"));

    const listed = await new RepoStateController({
      workspace,
      workspaceName,
      workingCopyId: working.value.id,
    }).listDirectory({ path: "/" });

    expect(Result.isOk(listed)).toBe(true);
    if (Result.isError(listed)) throw new Error("directory listing failed");
    expect(listed.value).toEqual({
      workspaceName,
      workingCopyId: working.value.id,
      path: "/",
      entries: [
        { name: "README.md", path: "/README.md", type: "file" },
        { name: "notes.md", path: "/notes.md", type: "file" },
        { name: "src", path: "/src", type: "directory" },
      ],
    });
  });

  it("returns a value error when an active working copy is missing", async () => {
    const { workspace, workspaceName } = createFakeArtifactsWorkspace();
    const listed = await new RepoStateController({
      workspace,
      workspaceName,
      workingCopyId: "missing-copy",
    }).listDirectory({ path: "/" });

    expect(Result.isError(listed)).toBe(true);
    if (Result.isError(listed)) {
      expect(listed.error.tag).toBe("WorkspaceCopyNotFoundError");
    }
  });
});
