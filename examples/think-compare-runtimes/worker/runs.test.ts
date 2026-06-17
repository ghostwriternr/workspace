import { describe, expect, test } from "vitest";

import { startComparisonRun } from "./runs";

describe("startComparisonRun", () => {
  test("emits ordered terminal events for both runtime wings", async () => {
    const run = await startComparisonRun({ now: fixedClock() });

    expect(run.id).toMatch(/^compare-/);
    expect(run.events.map((event) => event.sequence)).toEqual(run.events.map((_, index) => index));
    expect(run.events[0]).toMatchObject({ runtime: "both", kind: "run_started" });
    expect(run.events.at(-1)).toMatchObject({ runtime: "both", kind: "run_completed" });
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtime: "workspace", kind: "runtime_started" }),
        expect.objectContaining({ runtime: "workspace", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_started" }),
        expect.objectContaining({ runtime: "sandbox", kind: "runtime_completed" }),
        expect.objectContaining({ runtime: "workspace", kind: "tool_call", title: "shell" }),
        expect.objectContaining({ runtime: "sandbox", kind: "tool_call", title: "shell" }),
      ]),
    );
  });
});

function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 5, 16, 0, 0, tick++)).toISOString();
}
