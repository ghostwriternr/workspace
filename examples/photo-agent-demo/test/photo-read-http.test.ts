import { describe, expect, it } from "vitest";

import { handlePhotoReadRequest } from "../src/http/photo-read";

const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const currentJpg = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const draftJpg = new Uint8Array([0xff, 0xd8, 0xff, 2]);

describe("photo read HTTP route", () => {
  it("serves uploaded original image bytes", async () => {
    const workspaces = new FakeWorkspaces({ "/photos/original.png": originalPng });

    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original"),
      workspaces.asNamespace(),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(originalPng);
  });

  it("serves committed current image bytes", async () => {
    const workspaces = new FakeWorkspaces({ "/photos/current": currentJpg });

    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      workspaces.asNamespace(),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(currentJpg);
  });

  it("serves draft preview image bytes from the workspace's agent", async () => {
    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/draft"),
      new FakeWorkspaces({}).asNamespace(),
      { getByName: () => new FakePhotoAgent(draftJpg) },
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(draftJpg);
  });

  it("returns 404 when the requested image is missing", async () => {
    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      new FakeWorkspaces({}).asNamespace(),
    );

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "Photo not found" });
  });

  it("ignores non-photo-read routes", async () => {
    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/demo-capabilities"),
      new FakeWorkspaces({}).asNamespace(),
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

class FakeWorkspaces {
  constructor(private readonly files: Record<string, Uint8Array>) {}

  asNamespace() {
    return {
      getByName: () => ({
        readFile: async (path: string) => {
          const value = this.files[path];
          return value
            ? { status: "ok" as const, value }
            : { status: "error" as const, error: { tag: "PathNotFoundError" } };
        },
      }),
    };
  }
}
