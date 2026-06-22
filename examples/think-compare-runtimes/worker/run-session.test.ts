import { describe, expect, test } from "vitest";

import { applyRunMessage, createRunSession, RunEventSink } from "./run-session";

describe("run sessions", () => {
  test("createRunSession returns a PartySocket room path", () => {
    expect(createRunSession(() => "fixed-id")).toEqual({
      runId: "compare-fixed-id",
      socketPath: "/api/runs/compare-run/compare-fixed-id",
      events: [],
    });
  });

  test("event sink appends ordered events and broadcasts them", async () => {
    const broadcasts: string[] = [];
    const sink = new RunEventSink({
      runId: "compare-1",
      now: fixedClock(),
      initialEvents: [],
      broadcast: (message) => broadcasts.push(message),
      persist: async () => undefined,
    });

    const first = await sink.append({ runtime: "both", kind: "run_started", title: "Started", detail: "Run" });
    const second = await sink.append({ runtime: "workspace", kind: "runtime_started", title: "Workspace", detail: "Started" });

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(sink.events).toEqual([first, second]);
    expect(JSON.parse(broadcasts[0]!)).toEqual({ type: "event", event: first });
    expect(JSON.parse(broadcasts[1]!)).toEqual({ type: "event", event: second });
  });

  test("applyRunMessage replaces history and appends live events", () => {
    const history = [{ id: "e1", runId: "r", sequence: 1, runtime: "both", kind: "run_started", title: "Started", detail: "", timestamp: "2026-06-17T00:00:01.000Z" }] as const;
    const event = { id: "e0", runId: "r", sequence: 0, runtime: "workspace", kind: "runtime_started", title: "Workspace", detail: "", timestamp: "2026-06-17T00:00:00.000Z" } as const;

    expect(applyRunMessage([], { type: "history", events: [...history] })).toEqual([...history]);
    expect(applyRunMessage([...history], { type: "event", event })).toEqual([event, ...history]);
  });
});

function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 5, 17, 0, 0, tick++)).toISOString();
}
