import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { FakeArtifactsWorkspaceDriver, resetFakeArtifactsWorkspace } from "../fake-artifacts-workspace";

const photoBytes = new TextEncoder().encode("photo");

describe("WorkspaceFileCapability", () => {
  afterEach(() => resetFakeArtifactsWorkspace());

  it("adapts an Artifacts-backed photo draft into a scoped WorkerEntrypoint binding", async () => {
    const workspaceName = `photo-workspace-file-capability-${crypto.randomUUID()}`;
    const draftEditId = `${workspaceName}-copy`;
    new FakeArtifactsWorkspaceDriver({ [workspaceName]: {} })
      .install()
      .seedWorkingCopy(workspaceName, draftEditId, { "/photos/current": photoBytes });
    const object = env.WORKSPACE_OBJECTS.getByName(workspaceName);
    await object.recordCurrentRepository({
      repository: workspaceName,
      remote: `https://git.example/${workspaceName}.git`,
      defaultBranch: "main",
    });
    await object.recordCopy({
      copyId: draftEditId,
      baseRepository: workspaceName,
      remote: `https://git.example/${workspaceName}.git`,
      defaultBranch: "main",
      baseRevisionId: `revision-${workspaceName}-0`,
    });

    const capability = exports.WorkspaceFileCapability({
      props: { workspaceName, draftEditId },
    });

    await expect(capability.readFile("/photos/current")).resolves.toEqual({ status: "ok", value: photoBytes });
    await expect(capability.stat("/photos/current")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/photos/current",
        type: "file",
        size: photoBytes.byteLength,
      },
    });
    await expect(capability.readFile("/outside.txt")).resolves.toMatchObject({
      status: "error",
      error: { tag: "ScopedWorkspaceAccessError" },
    });
  });
});
