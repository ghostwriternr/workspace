import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { handleRepoImportRequest } from "../../src/http/repo-import";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("repo import HTTP", () => {
  it("imports a public GitHub repo into current Workspace files", async () => {
    const workspaceName = `repo-import-http-${crypto.randomUUID()}`;
    const response = await handleRepoImportRequest(
      new Request(`http://example.com/api/workspaces/${workspaceName}/imports/github`, {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example", ref: "main" }),
        headers: { "content-type": "application/json" },
      }),
      { workspaces: env.WORKSPACES },
      async (options) => Result.ok({
        snapshot: {
          type: "github",
          owner: options.owner,
          repo: options.repo,
          ref: options.ref ?? "main",
          commitSha: "def456",
        },
        async *entries() {
          yield { path: "README.md", contents: encoder.encode("# HTTP import") };
        },
      }),
    );

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
        commitSha: "def456",
      },
    });

    const readme = await Workspace.get(env.WORKSPACES, workspaceName).files.read("/README.md");
    expect(Result.isOk(readme)).toBe(true);
    if (Result.isOk(readme)) {
      expect(decoder.decode(readme.value)).toBe("# HTTP import");
    }
  });

  it("returns a client error for non-object import JSON", async () => {
    const response = await handleRepoImportRequest(
      new Request("http://example.com/api/workspaces/demo/imports/github", {
        method: "POST",
        body: "null",
        headers: { "content-type": "application/json" },
      }),
      { workspaces: env.WORKSPACES },
    );

    expect(response).toBeDefined();
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      status: "error",
      message: "Request body must be a JSON object.",
    });
  });

  it("passes an optional GitHub token to the source resolver", async () => {
    const resolveSource = vi.fn(async (options) => Result.ok({
      snapshot: {
        type: "github" as const,
        owner: options.owner,
        repo: options.repo,
        ref: "main",
        commitSha: "abc123",
      },
      async *entries() {
        yield { path: "README.md", contents: encoder.encode("# Token import") };
      },
    }));

    const response = await handleRepoImportRequest(
      new Request("http://example.com/api/workspaces/tokened/imports/github", {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example" }),
        headers: { "content-type": "application/json" },
      }),
      { workspaces: env.WORKSPACES, githubToken: "github-token" },
      resolveSource,
    );

    expect(response?.status).toBe(200);
    expect(resolveSource).toHaveBeenCalledWith(expect.objectContaining({
      owner: "cloudflare",
      repo: "example",
      token: "github-token",
    }));
  });

  it("syncs agent repo state after imports", async () => {
    const refreshRepoState = vi.fn();
    const response = await handleRepoImportRequest(
      new Request("http://example.com/api/workspaces/synced/imports/github", {
        method: "POST",
        body: JSON.stringify({ owner: "cloudflare", repo: "example" }),
        headers: { "content-type": "application/json" },
      }),
      { workspaces: env.WORKSPACES },
      async (options) => Result.ok({
        snapshot: {
          type: "github",
          owner: options.owner,
          repo: options.repo,
          ref: "main",
          commitSha: "abc123",
        },
        async *entries() {
          yield { path: "README.md", contents: encoder.encode("# Synced") };
        },
      }),
      { getByName: () => ({ refreshRepoState }) },
    );

    expect(response?.status).toBe(200);
    expect(refreshRepoState).toHaveBeenCalledWith(expect.objectContaining({
      workspaceName: "synced",
      source: expect.objectContaining({ owner: "cloudflare", repo: "example" }),
    }));
  });

  it("leaves unrelated routes for the next router", async () => {
    await expect(
      handleRepoImportRequest(
        new Request("http://example.com/api/other", { method: "POST" }),
        { workspaces: env.WORKSPACES },
      ),
    ).resolves.toBeUndefined();
  });
});
