import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { handleRepoImportRequest } from "../src/http/repo-import";

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
      env.WORKSPACES,
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
      env.WORKSPACES,
    );

    expect(response).toBeDefined();
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      status: "error",
      message: "Request body must be a JSON object.",
    });
  });

  it("leaves unrelated routes for the next router", async () => {
    await expect(
      handleRepoImportRequest(
        new Request("http://example.com/api/other", { method: "POST" }),
        env.WORKSPACES,
      ),
    ).resolves.toBeUndefined();
  });
});
