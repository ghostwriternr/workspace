import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { FakeArtifactsWorkspaceDriver, resetFakeArtifacts } from "@cloudflare/workspace/testing";

const readmeBytes = new TextEncoder().encode("# Repo");

describe("WorkspaceFileCapability", () => {
  afterEach(() => {
    resetFakeArtifacts();
  });

  it("adapts an Artifacts-backed working copy into a scoped WorkerEntrypoint binding", async () => {
    const { workspaceName, workingCopyId } = await installWorkingCopy({ "/README.md": readmeBytes });

    const capability = exports.WorkspaceFileCapability({
      props: { workspaceName, workingCopyId },
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
    const { workspaceName, workingCopyId } = await installWorkingCopy({ "/README.md": readmeBytes });

    const capability = exports.WorkspaceFileCapability({
      props: { workspaceName, workingCopyId },
    });

    await expect(capability.writeFile("notes/edit.md", new TextEncoder().encode("nested write"))).resolves.toEqual({ status: "ok" });
    await expect(capability.readFile("notes/edit.md")).resolves.toEqual({
      status: "ok",
      value: new TextEncoder().encode("nested write"),
    });
  });
});

async function installWorkingCopy(files: Record<string, Uint8Array>) {
  const workspaceName = "workspace-file-capability";
  const workingCopyId = `working-copy-${crypto.randomUUID()}`;
  new FakeArtifactsWorkspaceDriver({ [workspaceName]: {} })
    .install()
    .seedWorkingCopy(workspaceName, workingCopyId, files);
  const object = env.WORKSPACE_OBJECTS.getByName(workspaceName);
  await object.recordCurrentRepository({
    repository: workspaceName,
    remote: `https://git.example/${workspaceName}.git`,
    defaultBranch: "main",
  });
  await object.recordCopy({
    copyId: workingCopyId,
    createdAt: 100,
    baseRepository: workspaceName,
    remote: `https://git.example/${workspaceName}.git`,
    defaultBranch: "main",
    baseRevisionId: `revision-${workspaceName}-0`,
  });
  return { workspaceName, workingCopyId };
}
