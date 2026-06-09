import { afterEach, describe, expect, it } from "vitest";

import type { FakeWorkspaceObject } from "@cloudflare/workspace/testing";
import { handlePhotoUploadRequest } from "../src/http/photo-upload";
import { createFakeArtifactsWorkspace, resetFakeArtifactsWorkspace } from "./fake-artifacts-workspace";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("photo upload HTTP route", () => {
  afterEach(() => resetFakeArtifactsWorkspace());

  it("accepts image bytes and stores them in an Artifacts-backed Workspace", async () => {
    const { artifacts, driver, object } = createFakeArtifactsWorkspace();
    const request = new Request("http://example.com/api/workspaces/demo/photos/original", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: pngBytes,
    });

    const photoAgents = new FakePhotoAgents();

    const response = await handlePhotoUploadRequest(request, artifacts, workspaceObjects(object), photoAgents.asNamespace());

    expect(response?.status).toBe(201);
    await expect(response?.json()).resolves.toEqual({
      workspaceName: "demo",
      path: "/photos/original.png",
      contentType: "image/png",
      bytes: pngBytes.byteLength,
    });
    expect(driver.file("demo", "/photos/original.png")).toEqual(pngBytes);
    expect(photoAgents.agent("demo").refreshes).toBe(1);
  });

  it("creates a repository when remote Artifacts lookup returns a structured not-found error", async () => {
    const { artifacts, driver, object } = createFakeArtifactsWorkspace();
    const originalGet = artifacts.get.bind(artifacts);
    let firstGet = true;
    artifacts.get = async (name: string) => {
      if (firstGet) {
        firstGet = false;
        throw { name: "ArtifactsError", code: "NOT_FOUND", message: `Repository not found: ${name}` };
      }
      return originalGet(name);
    };

    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: pngBytes,
      }),
      artifacts,
      workspaceObjects(object),
    );

    expect(response?.status).toBe(201);
    expect(driver.file("demo", "/photos/original.png")).toEqual(pngBytes);
  });

  it("records the requested default branch when Artifacts create omits it", async () => {
    const { artifacts, object } = createFakeArtifactsWorkspace();
    artifacts.create = async (name: string) => {
      artifacts.createdRepositories.push(name);
      artifacts.driver.createRepository(name);
      return { name, remote: `https://git.example/${name}.git` };
    };

    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: pngBytes,
      }),
      artifacts,
      workspaceObjects(object),
    );

    expect(response?.status).toBe(201);
    await expect(object.repositoryAccess("demo")).resolves.toEqual({
      repository: "demo",
      remote: "https://git.example/demo.git",
      defaultBranch: "main",
    });
  });

  it("creates a repository when remote Artifacts lookup returns only a not-found message", async () => {
    const { artifacts, driver, object } = createFakeArtifactsWorkspace();
    const originalGet = artifacts.get.bind(artifacts);
    let firstGet = true;
    artifacts.get = async (name: string) => {
      if (firstGet) {
        firstGet = false;
        throw new Error(`ArtifactsError: Repository not found: ${name}.`);
      }
      return originalGet(name);
    };

    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: pngBytes,
      }),
      artifacts,
      workspaceObjects(object),
    );

    expect(response?.status).toBe(201);
    expect(driver.file("demo", "/photos/original.png")).toEqual(pngBytes);
  });

  it("does not create a repository when Artifacts lookup fails for reasons other than not found", async () => {
    const { object } = createFakeArtifactsWorkspace();
    const artifacts = {
      get: async () => {
        throw Object.assign(new Error("temporarily unavailable"), { name: "ArtifactsError", code: "INTERNAL_ERROR" });
      },
      create: async () => {
        throw new Error("create should not be called");
      },
      delete: async () => false,
    };

    await expect(handlePhotoUploadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: pngBytes,
      }),
      artifacts,
      workspaceObjects(object),
    )).rejects.toThrow("temporarily unavailable");
  });

  it("returns 415 for unsupported content types", async () => {
    const { artifacts, object } = createFakeArtifactsWorkspace();
    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not an image",
      }),
      artifacts,
      workspaceObjects(object),
    );

    expect(response?.status).toBe(415);
    await expect(response?.json()).resolves.toEqual({
      error: "Unsupported photo content type: text/plain",
    });
  });

  it("ignores non-upload routes", async () => {
    const { artifacts, object } = createFakeArtifactsWorkspace();
    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/demo-capabilities"),
      artifacts,
      workspaceObjects(object),
    );

    expect(response).toBeUndefined();
  });
});

function workspaceObjects(object: FakeWorkspaceObject) {
  return { getByName: () => object };
}

class FakePhotoAgents {
  private readonly byName = new Map<string, FakePhotoAgent>();

  asNamespace() {
    return {
      getByName: (name: string) => this.agent(name),
    };
  }

  agent(name: string): FakePhotoAgent {
    let agent = this.byName.get(name);
    if (!agent) {
      agent = new FakePhotoAgent();
      this.byName.set(name, agent);
    }
    return agent;
  }
}

class FakePhotoAgent {
  refreshes = 0;

  async refreshPhotoState() {
    this.refreshes += 1;
  }
}
