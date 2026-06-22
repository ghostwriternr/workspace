import { describe, expect, test } from "vitest";

import type { RunEventInput } from "../runs";
import { RuntimeAgentRecorder } from "./runtime-agent-recorder";

describe("RuntimeAgentRecorder", () => {
  test("streams recorded events to the run coordinator as they happen", async () => {
    const streamed: RunEventInput[] = [];
    const recorder = new RuntimeAgentRecorder("workspace", {
      async recordRuntimeEvent(input) {
        streamed.push(input);
      },
    });

    recorder.record({ kind: "runtime_note", title: "Preparing", detail: "Opening files" } as RunEventInput);
    recorder.record({ runtime: "workspace", kind: "agent_message", title: "Started", detail: "Kimi started" });
    await recorder.flush();

    expect(recorder.events).toEqual([
      { runtime: "workspace", kind: "runtime_note", title: "Preparing", detail: "Opening files" },
      { runtime: "workspace", kind: "agent_message", title: "Started", detail: "Kimi started" },
    ]);
    expect(streamed).toEqual(recorder.events);
  });
});
