import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { RepoImportController } from "../../src/repo/import-controller";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("RepoImportController", () => {
  it("preserves writeTree errors when cleanup discard fails", async () => {
    const controller = new RepoImportController({
      workspaces: {
        getByName: () => ({
          beginSession: async () => ({ status: "ok", value: { sessionId: "copy-1", createdAt: 1 } }),
          sessionWriteTreeBatch: async () => ({ status: "error", error: { tag: "InvalidPathError", path: "../escape" } }),
          sessionDiscard: async () => ({ status: "error", error: { tag: "SessionNotFoundError" } }),
        } as never),
      },
      resolveSource: async () => Result.ok({
        snapshot: {
          type: "github",
          owner: "cloudflare",
          repo: "example",
          ref: "main",
          commitSha: "abc123",
        },
        async *entries() {
          yield { path: "../escape", contents: encoder.encode("escape") };
        },
      }),
    });

    const result = await controller.importGitHubRepo({
      workspaceName: "write-tree-failed",
      owner: "cloudflare",
      repo: "example",
    });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.tag).toBe("InvalidPathError");
    }
  });

  it("discards the import copy when apply fails", async () => {
    const calls: string[] = [];
    const controller = new RepoImportController({
      workspaces: {
        getByName: () => ({
          beginSession: async () => {
            calls.push("copy");
            return { status: "ok", value: { sessionId: "copy-1", createdAt: 1 } };
          },
          sessionWriteTreeBatch: async () => {
            calls.push("writeTree");
            return { status: "ok" };
          },
          sessionCommit: async () => {
            calls.push("apply");
            return { status: "error", error: { tag: "SessionConflictError" } };
          },
          sessionDiscard: async () => {
            calls.push("discard");
            return { status: "ok" };
          },
        } as never),
      },
      resolveSource: async () => Result.ok({
        snapshot: {
          type: "github",
          owner: "cloudflare",
          repo: "example",
          ref: "main",
          commitSha: "abc123",
        },
        async *entries() {
          yield { path: "README.md", contents: encoder.encode("# Imported") };
        },
      }),
    });

    const result = await controller.importGitHubRepo({
      workspaceName: "apply-conflict",
      owner: "cloudflare",
      repo: "example",
    });

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.tag).toBe("SessionConflictError");
    }
    expect(calls).toEqual(["copy", "writeTree", "apply", "discard"]);
  });

  it("imports fake GitHub source entries and applies them to current Workspace files", async () => {
    const workspaceName = `repo-import-${crypto.randomUUID()}`;
    const controller = new RepoImportController({
      workspaces: env.WORKSPACES,
      resolveSource: async (options) => Result.ok({
        snapshot: {
          type: "github",
          owner: options.owner,
          repo: options.repo,
          ref: options.ref ?? "main",
          commitSha: "abc123",
        },
        async *entries() {
          yield { path: "README.md", contents: encoder.encode("# Imported") };
          yield { path: "src/index.ts", contents: encoder.encode("export const imported = true;\n") };
        },
      }),
    });

    const result = await controller.importGitHubRepo({
      workspaceName,
      owner: "cloudflare",
      repo: "example",
      ref: "main",
    });
    const workspace = Workspace.get(env.WORKSPACES, workspaceName);
    const readme = await workspace.files.read("/README.md");
    const source = await workspace.files.read("/src/index.ts");

    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value).toMatchObject({
        workspaceName,
        root: "/",
        source: {
          type: "github",
          owner: "cloudflare",
          repo: "example",
          ref: "main",
          commitSha: "abc123",
        },
      });
      expect(result.value.revisionId).toEqual(expect.any(String));
    }
    expect(Result.isOk(readme)).toBe(true);
    expect(Result.isOk(source)).toBe(true);
    if (Result.isOk(readme) && Result.isOk(source)) {
      expect(decoder.decode(readme.value)).toBe("# Imported");
      expect(decoder.decode(source.value)).toBe("export const imported = true;\n");
    }
  });
});
