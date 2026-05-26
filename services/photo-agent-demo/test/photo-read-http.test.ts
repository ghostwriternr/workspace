import { describe, expect, it } from "vitest";

import { handlePhotoReadRequest } from "../src/photo-read-http";

const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const currentPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);

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
    const workspaces = new FakeWorkspaces({ "/photos/current.png": currentPng });

    const response = await handlePhotoReadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      workspaces.asNamespace(),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(currentPng);
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
