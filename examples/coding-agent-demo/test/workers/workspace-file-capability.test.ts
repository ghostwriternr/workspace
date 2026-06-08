import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceEntry, WorkspaceStat } from "@cloudflare/workspace";
import {
  resetArtifactsWorkspaceDriverFactoryForTests,
  setArtifactsWorkspaceDriverFactoryForTests,
  type ArtifactsWorkspaceDriver,
} from "../../../../packages/workspace/src/workspace/artifacts/workspace-backend-client";

const readmeBytes = new TextEncoder().encode("# Repo");

describe("WorkspaceFileCapability", () => {
  afterEach(() => {
    resetArtifactsWorkspaceDriverFactoryForTests();
  });

  it("adapts an Artifacts-backed working copy into a scoped WorkerEntrypoint binding", async () => {
    const workingCopyId = `working-copy-${crypto.randomUUID()}`;
    const driver = new FakeArtifactsWorkspaceDriver({
      [workingCopyId]: {
        "/README.md": readmeBytes,
      },
    });
    setArtifactsWorkspaceDriverFactoryForTests(() => driver);

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
    const driver = new FakeArtifactsWorkspaceDriver({
      [workingCopyId]: {
        "/README.md": readmeBytes,
      },
    });
    setArtifactsWorkspaceDriverFactoryForTests(() => driver);

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

type Tree = Record<string, Uint8Array>;

class FakeArtifactsWorkspaceDriver implements ArtifactsWorkspaceDriver {
  constructor(private readonly repositories: Record<string, Tree>) {}

  async repositoryExists(repository: string): Promise<boolean> {
    return this.repositories[repository] !== undefined;
  }

  async readFile(repository: string, path: string): Promise<Uint8Array | null> {
    const contents = this.repositories[repository]?.[path];
    return contents ? new Uint8Array(contents) : null;
  }

  async list(repository: string, path: string): Promise<WorkspaceEntry[]> {
    const tree = this.repositories[repository] ?? {};
    const prefix = path === "/" ? "/" : `${path}/`;
    return Object.keys(tree)
      .filter((filePath) => filePath.startsWith(prefix))
      .map((filePath) => filePath.slice(prefix.length).split("/")[0])
      .filter((name, index, names) => name.length > 0 && names.indexOf(name) === index)
      .map((name) => ({ name, path: path === "/" ? `/${name}` : `${path}/${name}`, type: "file" as const }));
  }

  async stat(repository: string, path: string): Promise<WorkspaceStat | null> {
    const tree = this.repositories[repository] ?? {};
    const file = tree[path];
    if (file) {
      return { path, type: "file", size: file.byteLength, createdAt: 0, updatedAt: 0 };
    }
    if (path === "/") {
      return { path, type: "directory", size: null, createdAt: 0, updatedAt: 0 };
    }
    return null;
  }

  async writeFile(repository: string, path: string, contents: Uint8Array): Promise<void> {
    this.repositories[repository] ??= {};
    this.repositories[repository][path] = new Uint8Array(contents);
  }

  async deleteFile(repository: string, path: string): Promise<void> {
    delete this.repositories[repository]?.[path];
  }

  async applyWorkingCopy(): Promise<{ revisionId: string; createdAt: number }> {
    return { revisionId: "revision", createdAt: 0 };
  }
}
