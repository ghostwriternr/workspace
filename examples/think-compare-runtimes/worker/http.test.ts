import { describe, expect, test } from "vitest";

import { handleRequest } from "./http";

describe("handleRequest", () => {
  test("returns health status", async () => {
    const response = await handleRequest(new Request("https://example.com/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("starts a run session through the run coordinator", async () => {
    const starts: string[] = [];
    const response = await handleRequest(
      new Request("https://example.com/api/runs", { method: "POST" }),
      {
        startRun: async (runId) => {
          starts.push(runId);
          return {
            runId,
            socketPath: `/api/runs/compare-run/${runId}`,
            events: [{ id: `${runId}:0`, runId, sequence: 0, runtime: "both", kind: "run_started", title: "Started", detail: "", timestamp: "2026-06-17T00:00:00.000Z" }],
          };
        },
      },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { runId: string; socketPath: string; events: unknown[] };
    expect(body.runId).toMatch(/^compare-/);
    expect(body.socketPath).toBe(`/api/runs/compare-run/${body.runId}`);
    expect(body.events).toHaveLength(1);
    expect(starts).toEqual([body.runId]);
  });
});
