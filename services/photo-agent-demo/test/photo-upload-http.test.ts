import { describe, expect, it } from "vitest";

import { handlePhotoUploadRequest } from "../src/photo-upload-http";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("photo upload HTTP route", () => {
  it("accepts image bytes and stores them in Workspace", async () => {
    const workspaces = new FakeWorkspaces();
    const request = new Request("http://example.com/api/workspaces/demo/photos/original", {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: pngBytes,
    });

    const photoAgents = new FakePhotoAgents();

    const response = await handlePhotoUploadRequest(request, workspaces.asNamespace(), photoAgents.asNamespace());

    expect(response?.status).toBe(201);
    await expect(response?.json()).resolves.toEqual({
      workspaceName: "demo",
      path: "/photos/original.png",
      contentType: "image/png",
      bytes: pngBytes.byteLength,
    });
    expect(workspaces.workspace("demo").files["/photos/original.png"]).toEqual(pngBytes);
    expect(photoAgents.agent("demo").refreshes).toBe(1);
  });

  it("returns 415 for unsupported content types", async () => {
    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/workspaces/demo/photos/original", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "not an image",
      }),
      new FakeWorkspaces().asNamespace(),
    );

    expect(response?.status).toBe(415);
    await expect(response?.json()).resolves.toEqual({
      error: "Unsupported photo content type: text/plain",
    });
  });

  it("ignores non-upload routes", async () => {
    const response = await handlePhotoUploadRequest(
      new Request("http://example.com/api/demo-capabilities"),
      new FakeWorkspaces().asNamespace(),
    );

    expect(response).toBeUndefined();
  });
});

class FakeWorkspaces {
  private readonly byName = new Map<string, FakeWorkspace>();

  asNamespace() {
    return {
      getByName: (name: string) => this.workspace(name),
    };
  }

  workspace(name: string): FakeWorkspace {
    let workspace = this.byName.get(name);
    if (!workspace) {
      workspace = new FakeWorkspace();
      this.byName.set(name, workspace);
    }
    return workspace;
  }
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

class FakeWorkspace {
  readonly files: Record<string, Uint8Array> = {};
  private photosExists = false;

  async mkdir(path: string) {
    if (path !== "/photos") {
      throw new Error(`unexpected mkdir path: ${path}`);
    }

    if (this.photosExists) {
      return { status: "error" as const, error: { tag: "PathAlreadyExistsError" } };
    }

    this.photosExists = true;
    return { status: "ok" as const };
  }

  async writeFile(path: string, contents: Uint8Array) {
    this.files[path] = contents;
    return { status: "ok" as const };
  }
}
