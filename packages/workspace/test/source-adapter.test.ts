import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";
import { connectArtifactsRepository } from "@cloudflare/workspace/source-adapter";
import { createFakeArtifacts } from "@cloudflare/workspace/testing";

describe("Workspace source-adapter SPI", () => {
  it("connects an Artifacts repository to a Workspace", async () => {
    const { artifacts, object } = createFakeArtifacts({ repo: {} });
    const workspace = Workspace.bind({ artifacts, objects: { getByName: () => object } }).get("repo");

    const connected = await connectArtifactsRepository(workspace, {
      repository: {
        remote: "https://git.example/repo.git",
        defaultBranch: "trunk",
      },
    });

    expect(Result.isOk(connected)).toBe(true);
    await expect(object.currentRepository()).resolves.toEqual({
      repository: "repo",
      remote: "https://git.example/repo.git",
      defaultBranch: "trunk",
    });
  });

  it("returns Result errors when repository access metadata is incomplete", async () => {
    const { artifacts, object } = createFakeArtifacts({ repo: {} });
    const workspace = Workspace.bind({ artifacts, objects: { getByName: () => object } }).get("repo");

    const connected = await connectArtifactsRepository(workspace, {
      repository: { defaultBranch: "main" },
    });

    expect(Result.isError(connected)).toBe(true);
    if (Result.isError(connected)) {
      expect(connected.error).toEqual({
        tag: "WorkspaceArtifactsRepositoryAccessError",
        message: "Artifacts repository access metadata must include a remote URL.",
      });
    }
  });

  it("keeps Artifacts connection off the ordinary Workspace API", () => {
    const { artifacts, object } = createFakeArtifacts({ repo: {} });
    const workspaces = Workspace.bind({ artifacts, objects: { getByName: () => object } });
    const workspace = workspaces.get("repo");

    expect("adoptArtifactsRepository" in workspaces).toBe(false);
    expect("adoptArtifactsRepository" in workspace).toBe(false);
  });
});
