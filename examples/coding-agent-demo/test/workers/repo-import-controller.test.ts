import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { Workspace } from "@cloudflare/workspace";
import { FakeWorkspaceObject } from "@cloudflare/workspace/testing";
import { RepoImportController } from "../../src/repo/import-controller";

describe("RepoImportController", () => {
  it("imports public GitHub repositories through Artifacts", async () => {
    const imports: unknown[] = [];
    const workspaceObject = new FakeWorkspaceObject();
    const controller = new RepoImportController({
      workspaces: workspacesFor(workspaceObject),
      artifacts: {
        import: async (params: unknown) => {
          imports.push(params);
          return {
            id: "repo_123",
            remote: "https://git.example/workspace-one.git",
            defaultBranch: "main",
            token: "secret-token",
          };
        },
      },
    });

    const result = await controller.importGitHubRepo({
      workspaceName: "workspace-one",
      owner: "cloudflare",
      repo: "sandbox-sdk",
      ref: "main",
    });

    expect(imports).toEqual([
      {
        source: {
          url: "https://github.com/cloudflare/sandbox-sdk.git",
          branch: "main",
          depth: 1,
        },
        target: {
          name: "workspace-one",
          opts: {
            description: "Imported from github.com/cloudflare/sandbox-sdk",
          },
        },
      },
    ]);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toEqual({
        workspaceName: "workspace-one",
        root: "/",
        source: {
          type: "github",
          owner: "cloudflare",
          repo: "sandbox-sdk",
          ref: "main",
          repositoryId: "repo_123",
        },
        revisionId: "repo_123",
        createdAt: expect.any(Number),
      });
      await expect(workspaceObject.currentRepository()).resolves.toEqual({
        repository: "workspace-one",
        remote: "https://git.example/workspace-one.git",
        defaultBranch: "main",
      });
    }
  });

  it("uses an explicit import ref for Workspace git access", async () => {
    const workspaceObject = new FakeWorkspaceObject();
    const controller = new RepoImportController({
      workspaces: workspacesFor(workspaceObject),
      artifacts: {
        import: async () => ({
          id: "repo_456",
          remote: "https://git.example/workspace-master.git",
          token: "secret-token",
        }),
      },
    });

    const result = await controller.importGitHubRepo({
      workspaceName: "workspace-master",
      owner: "octocat",
      repo: "Hello-World",
      ref: "master",
    });

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      await expect(workspaceObject.currentRepository()).resolves.toEqual({
        repository: "workspace-master",
        remote: "https://git.example/workspace-master.git",
        defaultBranch: "master",
      });
    }
  });

  it("returns Artifacts import failures as Result errors", async () => {
    const controller = new RepoImportController({
      workspaces: workspacesFor(new FakeWorkspaceObject()),
      artifacts: {
        import: async () => {
          throw Object.assign(new Error("remote repository requires authentication"), {
            name: "ArtifactsError",
            code: "REMOTE_AUTH_REQUIRED",
            numericCode: 1008,
          });
        },
      },
    });

    const result = await controller.importGitHubRepo({
      workspaceName: "workspace-two",
      owner: "cloudflare",
      repo: "private-repo",
    });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error).toEqual({
        tag: "ArtifactsImportError",
        message: "remote repository requires authentication",
        code: "REMOTE_AUTH_REQUIRED",
      });
    }
  });
});

function workspacesFor(workspaceObject: FakeWorkspaceObject) {
  return Workspace.bind({
    artifacts: {
      get: async () => { throw new Error("not used"); },
      delete: async () => false,
    },
    objects: { getByName: () => workspaceObject },
  });
}
