import { describe, expect, it, vi } from "vitest";

import { handleRepoImportRequest } from "../../src/http/repo-import";

describe("repo import HTTP", () => {
  it("imports a public GitHub repo through Artifacts", async () => {
    const workspaceName = `repo-import-http-${crypto.randomUUID()}`;
    const importRepo = vi.fn(async () => ({
      id: "repo_456",
      name: workspaceName,
      description: null,
      defaultBranch: "main",
      remote: "https://artifacts.example/repo.git",
      token: "secret-token",
      tokenExpiresAt: "2026-01-01T00:00:00.000Z",
    }));

    const response = await handleRepoImportRequest(
      new Request(`http://example.com/api/workspaces/${workspaceName}/imports/github`, {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example", ref: "main" }),
        headers: { "content-type": "application/json" },
      }),
      { artifacts: { import: importRepo } },
    );

    expect(importRepo).toHaveBeenCalledWith({
      source: {
        url: "https://github.com/cloudflare/example.git",
        branch: "main",
        depth: 1,
      },
      target: {
        name: workspaceName,
        opts: {
          description: "Imported from github.com/cloudflare/example",
        },
      },
    });
    expect(response).toBeDefined();
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "imported",
      workspaceName,
      source: {
        type: "github",
        owner: "cloudflare",
        repo: "example",
        ref: "main",
        repositoryId: "repo_456",
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
      { artifacts: { import: async () => ({ id: "unused" }) } },
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
      { artifacts: { import: async () => ({ id: "repo_789" }) } },
      {
        agents: { getByName: () => ({ refreshRepoState }) },
      },
    );

    expect(response?.status).toBe(200);
    expect(refreshRepoState).toHaveBeenCalledWith(expect.objectContaining({
      workspaceName: "synced",
      source: expect.objectContaining({ owner: "cloudflare", repo: "example", repositoryId: "repo_789" }),
    }));
  });

  it("returns Artifacts import errors", async () => {
    const response = await handleRepoImportRequest(
      new Request("http://example.com/api/workspaces/failed/imports/github", {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example" }),
        headers: { "content-type": "application/json" },
      }),
      {
        artifacts: {
          import: async () => {
            throw Object.assign(new Error("upstream unavailable"), {
              name: "ArtifactsError",
              code: "UPSTREAM_UNAVAILABLE",
              numericCode: 1009,
            });
          },
        },
      },
    );

    expect(response?.status).toBe(502);
    await expect(response?.json()).resolves.toEqual({
      status: "error",
      error: {
        tag: "ArtifactsImportError",
        message: "upstream unavailable",
        code: "UPSTREAM_UNAVAILABLE",
      },
    });
  });

  it("leaves unrelated routes for the next router", async () => {
    await expect(
      handleRepoImportRequest(
        new Request("http://example.com/api/other", { method: "POST" }),
        { artifacts: { import: async () => ({ id: "unused" }) } },
      ),
    ).resolves.toBeUndefined();
  });
});
