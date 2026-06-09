import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { WorkspaceObject } from "../src/workers";

describe("WorkspaceObject", () => {
  it("stores current repository access metadata", async () => {
    const object = env.WORKSPACE_OBJECTS.getByName("repo") as DurableObjectStub<WorkspaceObject>;

    await object.recordCurrentRepository({
      repository: "repo",
      remote: "https://git.example/repo.git",
      defaultBranch: "main",
    });

    await expect(object.repositoryAccess("repo")).resolves.toEqual({
      repository: "repo",
      remote: "https://git.example/repo.git",
      defaultBranch: "main",
    });
    await expect(object.repositoryAccess("missing")).resolves.toBeUndefined();
  });

  it("stores and clears working copy repository access metadata", async () => {
    const object = env.WORKSPACE_OBJECTS.getByName("copy-repo") as DurableObjectStub<WorkspaceObject>;

    await object.recordCurrentRepository({
      repository: "copy-repo",
      remote: "https://git.example/copy-repo.git",
      defaultBranch: "main",
    });
    await object.recordCopy({
      copyId: "copy-repo-copy-1",
      baseRepository: "copy-repo",
      remote: "https://git.example/copy-repo.git",
      defaultBranch: "main",
      baseRevisionId: "revision-copy-repo-0",
    });

    await expect(object.repositoryAccess("copy-repo-copy-1")).resolves.toEqual({
      repository: "copy-repo-copy-1",
      remote: "https://git.example/copy-repo.git",
      defaultBranch: "main",
      baseRepository: "copy-repo",
      baseRevisionId: "revision-copy-repo-0",
    });

    await object.deleteCopy("copy-repo-copy-1");
    await expect(object.repositoryAccess("copy-repo-copy-1")).resolves.toBeUndefined();
  });
});
