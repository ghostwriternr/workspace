import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { normalizeAgentPath } from "../src/agent/path";
import { resultToModelToolOutput } from "../src/agent/tool-result";

describe("agent tool boundary", () => {
  it("normalizes model-style paths to Workspace paths", () => {
    expect(normalizeAgentPath("/README.md")).toBe("/README.md");
    expect(normalizeAgentPath("README.md")).toBe("/README.md");
    expect(normalizeAgentPath("./packages/sandbox/README.md")).toBe("/packages/sandbox/README.md");
    expect(normalizeAgentPath(".")).toBe("/");
  });

  it("keeps traversal visible for Workspace validation", () => {
    expect(normalizeAgentPath("../README.md")).toBe("/../README.md");
  });

  it("unwraps ok Results for model tools and preserves value errors", () => {
    expect(resultToModelToolOutput(Result.ok({ status: "file-read", path: "/README.md" }))).toEqual({
      status: "file-read",
      path: "/README.md",
    });
    expect(resultToModelToolOutput(Result.err({ tag: "PathNotFoundError", path: "/missing.md" }))).toEqual({
      status: "error",
      error: { tag: "PathNotFoundError", path: "/missing.md" },
    });
  });
});
