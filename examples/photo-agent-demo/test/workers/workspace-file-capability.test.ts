import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetArtifactsWorkspaceDriverFactoryForTests,
  setArtifactsWorkspaceDriverFactoryForTests,
} from "../../../../packages/workspace/src/workspace/artifacts/workspace-backend-client";
import { FakeArtifactsWorkspaceDriver } from "../fake-artifacts-workspace";

const photoBytes = new TextEncoder().encode("photo");

describe("WorkspaceFileCapability", () => {
  afterEach(() => resetArtifactsWorkspaceDriverFactoryForTests());

  it("adapts an Artifacts-backed photo draft into a scoped WorkerEntrypoint binding", async () => {
    const workspaceName = `photo-workspace-file-capability-${crypto.randomUUID()}`;
    const draftEditId = `${workspaceName}-copy`;
    const driver = new FakeArtifactsWorkspaceDriver({
      [draftEditId]: {
        "/photos/current": photoBytes,
      },
    });
    setArtifactsWorkspaceDriverFactoryForTests(() => driver);

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
