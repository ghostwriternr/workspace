import { describe, expect, test } from "vitest";

import { startComparisonRunFromApi } from "./run-api";

describe("startComparisonRunFromApi", () => {
  test("posts to the run endpoint and returns the event history", async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/runs");
      expect(init?.method).toBe("POST");
      return Response.json({
        id: "compare-1",
        events: [{ id: "event-1", sequence: 0, runtime: "both", kind: "run_started" }],
      });
    };

    await expect(startComparisonRunFromApi(fetcher)).resolves.toEqual({
      id: "compare-1",
      events: [{ id: "event-1", sequence: 0, runtime: "both", kind: "run_started" }],
    });
  });

  test("throws useful error text for failed starts", async () => {
    const fetcher = async () => new Response("capacity exhausted", { status: 503 });

    await expect(startComparisonRunFromApi(fetcher)).rejects.toThrow("capacity exhausted");
  });
});
