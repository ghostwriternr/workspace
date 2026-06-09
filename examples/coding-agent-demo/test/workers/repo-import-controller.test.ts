import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { Workspace } from "@cloudflare/workspace";
import { FakeWorkspaceObject } from "@cloudflare/workspace/testing";
import type { GitHubSource } from "@cloudflare/workspace-source-github";
import { RepoImportController } from "../../src/repo/import-controller";

describe("RepoImportController", () => {
  it("imports public GitHub repositories through the GitHub source adapter", async () => {
    const workspaceObject = new FakeWorkspaceObject();
    const importRepository = vi.fn(async ({ workspace, owner, repo, ref }) => Result.ok({
      workspaceName: workspace.name,
      importedAt: 1,
      source: {
        adapter: "github" as const,
        host: "github.com" as const,
        owner,
        repo,
        requestedRef: ref,
      },
      capture: {
        type: "artifacts-repository" as const,
        id: "repo_123",
      },
    }));
    const github: GitHubSource = { importRepository };
    const controller = new RepoImportController({
      workspaces: workspacesFor(workspaceObject),
      github,
    });

    const result = await controller.importGitHubRepo({
      workspaceName: "workspace-one",
      owner: "cloudflare",
      repo: "sandbox-sdk",
      ref: "main",
    });

    expect(importRepository).toHaveBeenCalledWith({
      workspace: expect.objectContaining({ name: "workspace-one" }),
      owner: "cloudflare",
      repo: "sandbox-sdk",
      ref: "main",
    });
    expect(result).toEqual(Result.ok({
      workspaceName: "workspace-one",
      root: "/",
      source: {
        adapter: "github",
        host: "github.com",
        owner: "cloudflare",
        repo: "sandbox-sdk",
        requestedRef: "main",
      },
      capture: {
        type: "artifacts-repository",
        id: "repo_123",
      },
      importedAt: 1,
    }));
  });

  it("returns GitHub source failures as Result errors", async () => {
    const controller = new RepoImportController({
      workspaces: workspacesFor(new FakeWorkspaceObject()),
      github: {
        importRepository: async () => Result.err({
          tag: "GitHubArtifactsImportError" as const,
          message: "remote repository requires authentication",
          code: "REMOTE_AUTH_REQUIRED",
        }),
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
        tag: "GitHubArtifactsImportError",
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
