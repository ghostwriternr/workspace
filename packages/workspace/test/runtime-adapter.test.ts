import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { Workspace } from "../src";
import { workspaceCopyRuntimeMount } from "../src/runtime-adapter";
import { createFakeArtifacts } from "./fake-artifacts";

const bytes = new TextEncoder().encode("hello");

describe("Workspace runtime adapter SPI", () => {
  it("describes how to mount a working copy without exposing file materialization", async () => {
    const { artifacts, object } = createFakeArtifacts({ repo: { "/README.md": bytes } });
    void object.recordCurrentRepository({
      repository: "repo",
      remote: "https://artifacts.example/workspaces/repo.git",
      defaultBranch: "main",
    });
    const workspace = Workspace.bind({ artifacts, objects: { getByName: () => object } }).get("repo");
    const copy = await workspace.copies.create({ label: "agent" });
    if (Result.isError(copy)) throw new Error("copy failed");

    const mount = await workspaceCopyRuntimeMount(copy.value);

    expect(Result.isOk(mount)).toBe(true);
    if (Result.isOk(mount)) {
      expect(mount.value).toEqual({
        copyId: copy.value.id,
        remote: "https://artifacts.example/workspaces/repo.git",
        ref: `refs/workspace/copies/${copy.value.id}`,
      });
    }
  });
});
