import { describe, expect, it } from "vitest";

import { handleDemoRequest } from "../src/http";

describe("photo agent demo worker", () => {
  it("returns a health response", async () => {
    const response = handleDemoRequest(new Request("http://example.com/health"));

    expect(response).toBeDefined();

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ ok: true });
  });

  it("describes the wired demo capabilities", async () => {
    const response = handleDemoRequest(
      new Request("http://example.com/api/demo-capabilities"),
    );

    expect(response).toBeDefined();

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      agent: "Think",
      execution: "Sandbox/ImageMagick",
      state: "Workspace durable files",
      durability: "draft commit or discard",
    });
  });

  it("keeps non-agent unknown API routes explicit", async () => {
    const response = handleDemoRequest(new Request("http://example.com/api/missing"));

    expect(response).toBeDefined();

    expect(response?.status).toBe(404);
    await expect(response?.text()).resolves.toBe("Not found");
  });

  it("leaves non-demo routes for the Worker runtime", () => {
    const response = handleDemoRequest(new Request("http://example.com/agents/photo/default"));

    expect(response).toBeUndefined();
  });
});
