import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { runDemoScenario } from "../../src/demo-scenario";
import { uploadOriginalPhoto } from "../../src/photo-upload";

const originalPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const editedPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

describe("photo workspace demo scenario", () => {
  it("stores an original, commits a draft, and returns the created revision", async () => {
    const workspaceName = `scenario-${crypto.randomUUID()}`;

    const upload = await uploadOriginalPhoto({
      workspaces: env.WORKSPACES,
      workspaceName,
      contents: originalPng,
      contentType: "image/png",
    });

    const report = await runDemoScenario({
      workspaces: env.WORKSPACES,
      imageEditor: new FakeImageEditor(),
      workspaceName,
    });

    expect(upload).toEqual({
      workspaceName,
      path: "/photos/original.png",
      contentType: "image/png",
      bytes: originalPng.byteLength,
    });

    expect(report).toMatchObject({
      workspaceName,
      originalPath: "/photos/original.png",
      currentPath: "/photos/current.png",
      operation: "grayscale",
      originalBytes: originalPng.byteLength,
      currentBytes: editedPng.byteLength,
      committed: true,
      session: {
        sessionId: expect.any(String),
      },
      revision: {
        revisionId: expect.any(String),
        createdAt: expect.any(Number),
      },
    });

    const workspace = env.WORKSPACES.getByName(workspaceName);
    await expect(workspace.list("/photos")).resolves.toEqual({
      status: "ok",
      value: [
        { name: "current.png", path: "/photos/current.png", type: "file" },
        { name: "original.png", path: "/photos/original.png", type: "file" },
      ],
    });

    const original = await workspace.readFile("/photos/original.png");
    expect(original.status).toBe("ok");
    if (original.status === "ok") {
      expect(original.value).toEqual(originalPng);
    }

    const current = await workspace.readFile("/photos/current.png");
    expect(current.status).toBe("ok");
    if (current.status === "ok") {
      expect(current.value).toEqual(editedPng);
    }

    const revisionCurrent = await workspace.readFile("/photos/current.png", {
      revisionId: report.revision.revisionId,
    });
    expect(revisionCurrent.status).toBe("ok");
    if (revisionCurrent.status === "ok") {
      expect(revisionCurrent.value).toEqual(editedPng);
    }
  });
});

class FakeImageEditor {
  async createOriginal() {
    return originalPng;
  }

  async makeDraftEdit(input: Uint8Array) {
    expect(input).toEqual(originalPng);
    return { operation: "grayscale" as const, contents: editedPng };
  }
}
