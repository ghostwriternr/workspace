import { afterEach, describe, expect, it } from "vitest";

import { handlePhotoReadRequest } from "../src/http/photo-read";
import { createFakeArtifactsWorkspace, resetFakeArtifactsWorkspace } from "./fake-artifacts-workspace";

const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const currentJpg = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const draftJpg = new Uint8Array([0xff, 0xd8, 0xff, 2]);

describe("photo read HTTP route", () => {
  afterEach(() => resetFakeArtifactsWorkspace());

  it("serves uploaded original image bytes from an Artifacts-backed Workspace", async () => {
    const { artifacts } = createFakeArtifactsWorkspace({ demo: { "/photos/original.png": originalPng } });

    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original"),
      artifacts,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(originalPng);
  });

  it("serves committed current image bytes", async () => {
    const { artifacts } = createFakeArtifactsWorkspace({ demo: { "/photos/current": currentJpg } });

    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      artifacts,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(currentJpg);
  });

  it("serves draft preview image bytes from the workspace's agent", async () => {
    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/draft"),
      createFakeArtifactsWorkspace({ demo: {} }).artifacts,
      { getByName: () => new FakePhotoAgent(draftJpg) },
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(draftJpg);
  });

  it("returns 404 when the requested image is missing", async () => {
    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      createFakeArtifactsWorkspace({ demo: {} }).artifacts,
    );

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "Photo not found" });
  });

  it("returns 404 when the workspace repository is missing", async () => {
    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      createFakeArtifactsWorkspace().artifacts,
    );

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "Photo not found" });
  });

  it("ignores non-photo-read routes", async () => {
    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/demo-capabilities"),
      createFakeArtifactsWorkspace().artifacts,
    );

    expect(response).toBeUndefined();
  });
});

class FakePhotoAgent {
  constructor(private readonly draft: Uint8Array) {}

  async readDraftImage() {
    return { status: "ok" as const, value: this.draft };
  }
}
