import { env } from "cloudflare:workers";
import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { Workspace } from "@cloudflare/workspace";

import { RepoImportController } from "../src/repo/import-controller";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("RepoImportController", () => {
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
