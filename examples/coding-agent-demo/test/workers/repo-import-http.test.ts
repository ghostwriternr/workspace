import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { Workspace } from "@cloudflare/workspace";
import { FakeWorkspaceObject } from "@cloudflare/workspace/testing";
import type { GitHubSource } from "@cloudflare/workspace-source-github";
import { handleRepoImportRequest } from "../../src/http/repo-import";

describe("repo import HTTP", () => {
  it("imports a public GitHub repo through the GitHub source", async () => {
    const workspaceName = `repo-import-http-${crypto.randomUUID()}`;
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
    }));

    const response = await handleRepoImportRequest(
      new Request(`http://example.com/api/workspaces/${workspaceName}/imports/github`, {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example", ref: "main" }),
        headers: { "content-type": "application/json" },
      }),
      runtimeFor({ importRepository }),
    );

    expect(importRepository).toHaveBeenCalledWith({
      workspace: expect.objectContaining({ name: workspaceName }),
      owner: "cloudflare",
      repo: "example",
      ref: "main",
    });
    expect(response).toBeDefined();
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "imported",
      workspaceName,
      source: {
        adapter: "github",
        host: "github.com",
        owner: "cloudflare",
        repo: "example",
        requestedRef: "main",
      },
    });
  });

  it("returns a client error for non-object import JSON", async () => {
    const response = await handleRepoImportRequest(
      new Request("http://example.com/api/workspaces/demo/imports/github", {
        method: "POST",
        body: "null",
        headers: { "content-type": "application/json" },
      }),
      runtimeFor(successfulGitHubSource()),
    );

    expect(response).toBeDefined();
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      status: "error",
      message: "Request body must be a JSON object.",
    });
  });

  it("syncs agent repo state after imports", async () => {
    const refreshRepoState = vi.fn();
    const response = await handleRepoImportRequest(
      new Request("http://example.com/api/workspaces/synced/imports/github", {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example" }),
        headers: { "content-type": "application/json" },
      }),
      runtimeFor(successfulGitHubSource()),
      {
        agents: { getByName: () => ({ refreshRepoState }) },
      },
    );

    expect(response?.status).toBe(200);
    expect(refreshRepoState).toHaveBeenCalledWith(expect.objectContaining({
      workspaceName: "synced",
      source: expect.objectContaining({ owner: "cloudflare", repo: "example" }),
      importedAt: 1,
    }));
  });

  it("returns GitHub source import errors", async () => {
    const response = await handleRepoImportRequest(
      new Request("http://example.com/api/workspaces/failed/imports/github", {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example" }),
        headers: { "content-type": "application/json" },
      }),
      runtimeFor({
        importRepository: async () => Result.err({
          tag: "GitHubSourceImportError" as const,
          message: "upstream unavailable",
          code: "UPSTREAM_UNAVAILABLE",
        }),
      }),
    );

    expect(response?.status).toBe(502);
    await expect(response?.json()).resolves.toEqual({
      status: "error",
      error: {
        tag: "GitHubSourceImportError",
        message: "upstream unavailable",
        code: "UPSTREAM_UNAVAILABLE",
      },
    });
  });

  it("leaves unrelated routes for the next router", async () => {
    await expect(
      handleRepoImportRequest(
        new Request("http://example.com/api/other", { method: "POST" }),
        runtimeFor(successfulGitHubSource()),
      ),
    ).resolves.toBeUndefined();
  });
});

function runtimeFor(github: GitHubSource) {
  const workspaceObject = new FakeWorkspaceObject();
  return {
    github,
    workspaces: Workspace.bind({
      artifacts: {
        get: async () => { throw new Error("not used"); },
        delete: async () => false,
      },
      objects: { getByName: () => workspaceObject },
    }),
  };
}

function successfulGitHubSource(): GitHubSource {
  return {
    importRepository: async ({ workspace, owner, repo, ref }) => Result.ok({
      workspaceName: workspace.name,
      importedAt: 1,
      source: {
        adapter: "github",
        host: "github.com",
        owner,
        repo,
        ...(ref ? { requestedRef: ref } : {}),
      },
    }),
  };
}
