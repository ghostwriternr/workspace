import { describe, expect, it } from "vitest";

import { handlePhotoEditRequest } from "../src/photo-edit-http";

const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const editedPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);

describe("photo edit HTTP route", () => {
  it("runs the grayscale scenario and returns the report", async () => {
    const workspaces = new FakeWorkspaces({ "/photos/original.png": originalPng });
    const response = await handlePhotoEditRequest(
      new Request("http://example.com/api/workspaces/demo/demo/grayscale", { method: "POST" }),
      {
        workspaces: workspaces.asNamespace(),
        createImageEditor: () => new FakeImageEditor(),
      },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      workspaceName: "demo",
      originalPath: "/photos/original.png",
      currentPath: "/photos/current.png",
      operation: "grayscale",
      originalBytes: originalPng.byteLength,
      currentBytes: editedPng.byteLength,
      committed: true,
      session: { sessionId: "session-1" },
      revision: { revisionId: "revision-1" },
    });
    expect(workspaces.files["/photos/current.png"]).toEqual(editedPng);
  });

  it("returns 404 when no original upload exists", async () => {
    const response = await handlePhotoEditRequest(
      new Request("http://example.com/api/workspaces/demo/demo/grayscale", { method: "POST" }),
      {
        workspaces: new FakeWorkspaces({}).asNamespace(),
        createImageEditor: () => new FakeImageEditor(),
      },
    );

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "No uploaded original photo found" });
  });

  it("ignores non-grayscale routes", async () => {
    const response = await handlePhotoEditRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      {
        workspaces: new FakeWorkspaces({}).asNamespace(),
        createImageEditor: () => new FakeImageEditor(),
      },
    );

    expect(response).toBeUndefined();
  });
});

class FakeImageEditor {
  async createOriginal(): Promise<Uint8Array> {
    throw new Error("upload should provide the original");
  }

  async makeDraftEdit(input: Uint8Array) {
    expect(input).toEqual(originalPng);
    return { operation: "grayscale" as const, contents: editedPng };
  }
}

class FakeWorkspaces {
  constructor(readonly files: Record<string, Uint8Array>) {}

  asNamespace() {
    return { getByName: () => new FakeWorkspace(this.files) };
  }
}

class FakeWorkspace {
  constructor(private readonly files: Record<string, Uint8Array>) {}

  async readFile(path: string) {
    const value = this.files[path];
    return value
      ? { status: "ok" as const, value }
      : { status: "error" as const, error: { tag: "PathNotFoundError" } };
  }

  async beginSession() {
    return new FakeSession(this.files);
  }
}

class FakeSession {
  constructor(private readonly files: Record<string, Uint8Array>) {}

  async info() {
    return { status: "ok" as const, value: { sessionId: "session-1", createdAt: 1 } };
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.files[path] = contents;
    return { status: "ok" as const };
  }

  async commit() {
    return { status: "ok" as const, value: { revisionId: "revision-1", createdAt: 2 } };
  }
}
