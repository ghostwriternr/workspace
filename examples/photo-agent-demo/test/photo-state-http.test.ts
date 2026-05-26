import { describe, expect, it } from "vitest";

import { handlePhotoStateRequest } from "../src/http/photo-state";

const state = {
  workspaceName: "demo",
  original: { exists: true, path: "/photos/original.png", bytes: 4 },
  current: { exists: false },
  draft: { exists: true, draftEditId: "session-1", path: "/photos/current", bytes: 5 },
};

describe("photo state HTTP route", () => {
  it("returns passive photo state from the workspace's agent", async () => {
    const response = await handlePhotoStateRequest(
      new Request("http://example.com/api/workspaces/demo/photo-state"),
      { getByName: () => new FakePhotoAgent() },
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual(state);
  });

  it("ignores unrelated routes", async () => {
    const response = await handlePhotoStateRequest(
      new Request("http://example.com/api/workspaces/demo/photos/current"),
      { getByName: () => new FakePhotoAgent() },
    );

    expect(response).toBeUndefined();
  });
});

class FakePhotoAgent {
  async photoState() {
    return state;
  }
}
