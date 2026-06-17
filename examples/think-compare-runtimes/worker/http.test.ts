import { describe, expect, test } from "vitest";

import { handleRequest } from "./http";

describe("handleRequest", () => {
  test("returns health status", async () => {
    const response = await handleRequest(new Request("https://example.com/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("starts a fake comparison run", async () => {
    const response = await handleRequest(new Request("https://example.com/api/runs", { method: "POST" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; events: unknown[] };
    expect(body).toMatchObject({ id: expect.stringMatching(/^compare-/) });
    expect(body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_completed" }),
      ]),
    );
  });
});
