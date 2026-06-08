import { afterEach, describe, expect, it } from "vitest";

import { handlePhotoUploadRequest } from "../src/http/photo-upload";
import { createFakeArtifactsWorkspace, resetFakeArtifactsWorkspace } from "./fake-artifacts-workspace";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("photo upload HTTP route", () => {
  afterEach(() => resetFakeArtifactsWorkspace());

  it("accepts image bytes and stores them in an Artifacts-backed Workspace", async () => {
    const { artifacts, driver } = createFakeArtifactsWorkspace();
    const request = new Request("http://example.com/api/workspaces/demo/photos/original", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: pngBytes,
    });

    const photoAgents = new FakePhotoAgents();

    const response = await handlePhotoUploadRequest(request, artifacts, photoAgents.asNamespace());

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

  it("does not create a repository when Artifacts lookup fails for reasons other than not found", async () => {
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
    )).rejects.toThrow("temporarily unavailable");
  });

  it("returns 415 for unsupported content types", async () => {
    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not an image",
      }),
      createFakeArtifactsWorkspace().artifacts,
    );

    expect(response?.status).toBe(415);
    await expect(response?.json()).resolves.toEqual({
      error: "Unsupported photo content type: text/plain",
    });
  });

  it("ignores non-upload routes", async () => {
    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/demo-capabilities"),
      createFakeArtifactsWorkspace().artifacts,
    );

    expect(response).toBeUndefined();
  });
});

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
