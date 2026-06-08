import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { FakeArtifactsWorkspaceDriver, resetFakeArtifacts } from "@cloudflare/workspace/testing";

const readmeBytes = new TextEncoder().encode("# Repo");

describe("WorkspaceFileCapability", () => {
  afterEach(() => {
    resetFakeArtifacts();
  });

  it("adapts an Artifacts-backed working copy into a scoped WorkerEntrypoint binding", async () => {
    const workingCopyId = `working-copy-${crypto.randomUUID()}`;
    new FakeArtifactsWorkspaceDriver({
      [workingCopyId]: {
        "/README.md": readmeBytes,
      },
    }).install();

    const capability = exports.WorkspaceFileCapability({
      props: { workspaceName: "workspace-file-capability", workingCopyId },
    });

    await expect(capability.readFile("README.md")).resolves.toEqual({ status: "ok", value: readmeBytes });
    await expect(capability.stat("./README.md")).resolves.toMatchObject({
      status: "ok",
      value: {
        path: "/README.md",
        type: "file",
        size: readmeBytes.byteLength,
      },
    });
    await expect(capability.readFile("../README.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "ScopedWorkspacePathError" },
    });
    await expect(capability.readFile("/missing.md")).resolves.toMatchObject({
      status: "error",
      error: { tag: "PathNotFoundError" },
    });
  });

  it("creates parent directories for nested scoped writes", async () => {
    const workingCopyId = `working-copy-${crypto.randomUUID()}`;
    new FakeArtifactsWorkspaceDriver({
      [workingCopyId]: {
        "/README.md": readmeBytes,
      },
    }).install();

    const capability = exports.WorkspaceFileCapability({
      props: { workspaceName: "workspace-file-capability", workingCopyId },
    });

    await expect(capability.writeFile("notes/edit.md", new TextEncoder().encode("nested write"))).resolves.toEqual({ status: "ok" });
    await expect(capability.readFile("notes/edit.md")).resolves.toEqual({
      status: "ok",
      value: new TextEncoder().encode("nested write"),
    });
  });
});
