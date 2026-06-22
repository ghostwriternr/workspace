import { describe, expect, test } from "vitest";

import { startComparisonRunFromApi } from "./run-api";

describe("startComparisonRunFromApi", () => {
  test("posts to the run endpoint and returns the run session", async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/runs");
      expect(init?.method).toBe("POST");
      return Response.json({
        runId: "compare-1",
        socketPath: "/api/runs/compare-run/compare-1",
        events: [{ id: "event-1", sequence: 0, runtime: "both", kind: "run_started" }],
      });
    };

    await expect(startComparisonRunFromApi(fetcher)).resolves.toEqual({
      runId: "compare-1",
      socketPath: "/api/runs/compare-run/compare-1",
      events: [{ id: "event-1", sequence: 0, runtime: "both", kind: "run_started" }],
    });
  });

  test("throws useful error text for failed starts", async () => {
    const fetcher = async () => new Response("capacity exhausted", { status: 503 });

    await expect(startComparisonRunFromApi(fetcher)).rejects.toThrow("capacity exhausted");
  });
});
