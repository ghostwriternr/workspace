import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { RepoImportController } from "../../src/repo/import-controller";

describe("RepoImportController", () => {
  it("imports public GitHub repositories through Artifacts", async () => {
    const imports: unknown[] = [];
    const controller = new RepoImportController({
      artifacts: {
        import: async (params: unknown) => {
          imports.push(params);
          return {
            id: "repo_123",
            name: "workspace-one",
            description: null,
            defaultBranch: "main",
            remote: "https://artifacts.example/workspace-one.git",
            token: "secret-token",
            tokenExpiresAt: "2026-01-01T00:00:00.000Z",
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
    }
  });

  it("returns Artifacts import failures as Result errors", async () => {
    const controller = new RepoImportController({
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
