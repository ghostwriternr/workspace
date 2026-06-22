import { describe, expect, test } from "vitest";

import { KIMI_TURN_ATTEMPT_TIMEOUT_MS, isRetryableThinkTurnError, thinkTurnRetryDelayMs, withRuntimeSetupTimeout } from "./runtime-retry";

describe("runtime Think agent retry classification", () => {
  test("retries generic Kimi stream failures", () => {
    expect(isRetryableThinkTurnError(new Error("Think turn ended in status=error: An error occurred."))).toBe(true);
  });

  test("retries explicit Kimi capacity failures", () => {
    expect(isRetryableThinkTurnError(new Error("Capacity temporarily exceeded, please try again."))).toBe(true);
  });

  test("retries Kimi submissions that remain running too long", () => {
    expect(isRetryableThinkTurnError(new Error("Kimi turn timed out waiting for submission abc."))).toBe(true);
    expect(KIMI_TURN_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  test("does not retry deterministic application failures", () => {
    expect(isRetryableThinkTurnError(new Error("Workspace runtime dependencies were not created."))).toBe(false);
  });

  test("uses increasing retry delays", () => {
    expect(thinkTurnRetryDelayMs(1)).toBeLessThan(thinkTurnRetryDelayMs(2));
    expect(thinkTurnRetryDelayMs(2)).toBeLessThan(thinkTurnRetryDelayMs(3));
  });

  test("turns runtime setup hangs into visible failures", async () => {
    await expect(
      withRuntimeSetupTimeout(new Promise(() => undefined), 1, "setup timed out"),
    ).rejects.toThrow("setup timed out");
  });
});
