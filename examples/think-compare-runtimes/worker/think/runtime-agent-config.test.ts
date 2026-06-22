import { describe, expect, test } from "vitest";

import { RUNTIME_AGENT_CHAT_RECOVERY, RUNTIME_AGENT_MAX_STEPS } from "./runtime-agent-config";

describe("runtime Think agent config", () => {
  test("matches the cf-workspace comparison harness step behavior", () => {
    expect(RUNTIME_AGENT_CHAT_RECOVERY).toBe(false);
    expect(RUNTIME_AGENT_MAX_STEPS).toBe(Number.POSITIVE_INFINITY);
  });
});
