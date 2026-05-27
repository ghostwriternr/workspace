import { describe, expect, it } from "vitest";

import { WorkspaceFileCapability } from "../src/workspace/workspace-file-capability";

const photoBytes = new TextEncoder().encode("photo");

describe("WorkspaceFileCapability", () => {
  it("reuses the scoped file capability across file operations", async () => {
    const workspace = new FakeWorkspaceObject();
    const capability = new WorkspaceFileCapability(
      { props: { workspaceName: "demo", draftEditId: "draft-1" }, exports: {} } as never,
      { WORKSPACES: { getByName: () => workspace } } as never,
    );

    await expect(capability.readFile("/photos/current")).resolves.toEqual(photoBytes);
    await expect(capability.stat("/photos/current")).resolves.toMatchObject({
      path: "/photos/current",
      type: "file",
      size: photoBytes.byteLength,
    });

    expect(workspace.getSessionCount).toBe(1);
  });
});

class FakeWorkspaceObject {
  getSessionCount = 0;

  async beginSession() {
    throw new Error("not used");
  }

  async getSession(sessionId: string) {
    this.getSessionCount += 1;
    return { status: "ok" as const, value: { sessionId, createdAt: 1 } };
  }

  async mkdir(_path: string) {
    return { status: "ok" as const };
  }

  async writeFile(_path: string, _contents: Uint8Array) {
    return { status: "ok" as const };
  }

  async readFile(_path: string) {
    return { status: "error" as const, error: pathNotFound(_path) };
  }

  async list(_path: string) {
    return { status: "ok" as const, value: [] };
  }

  async stat(path: string) {
    return { status: "ok" as const, value: { path, type: "file" as const, size: photoBytes.byteLength, createdAt: 1, updatedAt: 1 } };
  }

  async delete(_path: string) {
    return { status: "ok" as const };
  }

  async sessionMkdir(_sessionId: string, _path: string) {
    return { status: "ok" as const };
  }

  async sessionWriteFile(_sessionId: string, _path: string, _contents: Uint8Array) {
    return { status: "ok" as const };
  }

  async sessionReadFile(_sessionId: string, path: string) {
    return path === "/photos/current"
      ? { status: "ok" as const, value: photoBytes }
      : { status: "error" as const, error: pathNotFound(path) };
  }

  async sessionList(_sessionId: string, _path: string) {
    return { status: "ok" as const, value: [] };
  }

  async sessionStat(_sessionId: string, path: string) {
    return { status: "ok" as const, value: { path, type: "file" as const, size: photoBytes.byteLength, createdAt: 1, updatedAt: 1 } };
  }

  async sessionDelete(_sessionId: string, _path: string) {
    return { status: "ok" as const };
  }

  async sessionCommit(_sessionId: string) {
    return { status: "ok" as const, value: { revisionId: "revision-1", createdAt: 2 } };
  }

  async sessionDiscard(_sessionId: string) {
    return { status: "ok" as const };
  }
}

function pathNotFound(path: string) {
  return {
    tag: "PathNotFoundError" as const,
    path,
    message: `Path not found: ${path}`,
  };
}
