import { describe, expect, test } from "vitest";

import type { RunEventInput } from "../runs";
import { hasSuccessfulValidation, completionSummaryAfterValidatedTurnFailure } from "./runtime-completion";

describe("runtime completion classification", () => {
  test("recognizes successful npm validation from tool results", () => {
    const events: RunEventInput[] = [
      {
        runtime: "sandbox",
        kind: "agent_tool_result",
        title: "Think shell result",
        detail: JSON.stringify({ command: "npm run check", exitCode: 0, stdout: "ok", stderr: "" }),
      },
    ];

    expect(hasSuccessfulValidation(events)).toBe(true);
  });

  test("does not treat failed validation or unrelated commands as success", () => {
    expect(
      hasSuccessfulValidation([
        {
          runtime: "sandbox",
          kind: "agent_tool_result",
          title: "Think shell result",
          detail: JSON.stringify({ command: "npm run check", exitCode: 1 }),
        },
      ]),
    ).toBe(false);
    expect(
      hasSuccessfulValidation([
        {
          runtime: "sandbox",
          kind: "agent_tool_result",
          title: "Think shell result",
          detail: JSON.stringify({ command: "ls -la", exitCode: 0 }),
        },
      ]),
    ).toBe(false);
  });

  test("creates an honest fallback summary when Kimi fails after validation", () => {
    const summary = completionSummaryAfterValidatedTurnFailure(
      new Error("Think turn ended in status=error: An error occurred."),
    );

    expect(summary).toContain("npm run check passed");
    expect(summary).toContain("final response failed");
  });
});
