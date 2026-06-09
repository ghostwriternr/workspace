import { afterEach, describe, expect, test } from "vitest";
import { Result } from "better-result";
import { Workspace } from "@cloudflare/workspace";
import { createFakeArtifacts, resetFakeArtifacts, FakeArtifactsBinding, type FakeArtifactsWorkspaceDriver } from "@cloudflare/workspace/testing";

import { createGitHubSource } from "../src/index";

describe("GitHub source", () => {
  afterEach(() => resetFakeArtifacts());

  test("imports a GitHub repository through Artifacts and connects it to a Workspace", async () => {
    const fake = createFakeArtifacts();
    const artifacts = new ImportingArtifactsBinding(fake.driver);
    const workspaces = Workspace.bind({ artifacts, objects: { getByName: () => fake.object } });
    const workspace = workspaces.get("repo-one");
    const github = createGitHubSource({ artifacts });

    const imported = await github.importRepository({
      workspace,
      owner: "cloudflare",
      repo: "sandbox-sdk",
      ref: "main",
    });

    expect(Result.isOk(imported)).toBe(true);
    if (Result.isError(imported)) throw new Error(imported.error.message);

    expect(artifacts.imports).toEqual([
      {
        source: {
          url: "https://github.com/cloudflare/sandbox-sdk.git",
          branch: "main",
          depth: 1,
        },
        target: {
          name: "repo-one",
          opts: {
            description: "Imported from github.com/cloudflare/sandbox-sdk",
          },
        },
      },
    ]);
    expect(await fake.object.currentRepository()).toEqual({
      repository: "repo-one",
      remote: "https://git.example/repo-one.git",
      defaultBranch: "main",
    });
    expect(imported.value).toMatchObject({
      workspaceName: "repo-one",
      source: {
        adapter: "github",
        host: "github.com",
        owner: "cloudflare",
        repo: "sandbox-sdk",
        requestedRef: "main",
      },
      capture: {
        type: "artifacts-repository",
        id: "repo-one",
      },
    });
  });

  test("rejects invalid GitHub repository names before importing", async () => {
    const fake = createFakeArtifacts();
    const artifacts = new ImportingArtifactsBinding(fake.driver);
    const workspace = Workspace.bind({ artifacts, objects: { getByName: () => fake.object } }).get("repo-two");
    const github = createGitHubSource({ artifacts });

    const imported = await github.importRepository({
      workspace,
      owner: "cloudflare/example",
      repo: "sandbox-sdk",
    });

    expect(Result.isError(imported)).toBe(true);
    if (Result.isOk(imported)) throw new Error("expected import to fail");
    expect(imported.error).toMatchObject({
      tag: "InvalidGitHubRepositoryError",
      message: "GitHub owner must be a valid repository owner name.",
    });
    expect(artifacts.imports).toEqual([]);
  });

  test("maps Artifacts import failures to Result errors", async () => {
    const fake = createFakeArtifacts();
    const artifacts = new ImportingArtifactsBinding(fake.driver);
    artifacts.failImport = true;
    const workspace = Workspace.bind({ artifacts, objects: { getByName: () => fake.object } }).get("repo-three");
    const github = createGitHubSource({ artifacts });

    const imported = await github.importRepository({
      workspace,
      owner: "cloudflare",
      repo: "sandbox-sdk",
    });

    expect(Result.isError(imported)).toBe(true);
    if (Result.isOk(imported)) throw new Error("expected import to fail");
    expect(imported.error).toMatchObject({
      tag: "GitHubArtifactsImportError",
      message: "Artifacts import failed.",
      code: "INTERNAL",
    });
  });
});

type ArtifactsImportParams = {
  source: { url: string; branch?: string; depth?: number };
  target: { name: string; opts?: { description?: string; readOnly?: boolean } };
};

class ImportingArtifactsBinding extends FakeArtifactsBinding {
  readonly imports: ArtifactsImportParams[] = [];
  failImport = false;

  constructor(readonly fakeDriver: FakeArtifactsWorkspaceDriver) {
    super(fakeDriver);
  }

  async import(params: ArtifactsImportParams): Promise<{ id: string; name: string; remote: string; defaultBranch: string }> {
    this.imports.push(params);
    if (this.failImport) {
      throw Object.assign(new Error("Artifacts import failed."), {
        name: "ArtifactsError" as const,
        code: "INTERNAL",
      });
    }
    this.fakeDriver.createRepository(params.target.name);
    return {
      id: params.target.name,
      name: params.target.name,
      remote: `https://git.example/${params.target.name}.git`,
      defaultBranch: params.source.branch ?? "main",
    };
  }
}
