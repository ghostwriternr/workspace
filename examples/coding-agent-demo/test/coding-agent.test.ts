import { describe, expect, it } from "vitest";

import { codingAgentPrompt } from "../src/agent/prompt";
import { CODING_TOOL_DESCRIPTIONS, CODING_TOOL_NAMES } from "../src/agent/tools";

describe("coding agent", () => {
  it("exposes read, write, edit, and run", () => {
    expect(CODING_TOOL_NAMES).toEqual(["read", "write", "edit", "run"]);
  });

  it("does not leak implementation details into the prompt", () => {
    const prompt = codingAgentPrompt("demo");

    for (const term of ["Think", "session", "copy ID", "RPC", "R2", "SQLite", "Durable Object", "runWorkspaceWorker", "applyEdit", "discardEdit"]) {
      expect(prompt).not.toContain(term);
    }
  });

  it("teaches staged-copy semantics and user-controlled publication", () => {
    const prompt = codingAgentPrompt("demo");

    expect(prompt).toContain("staged");
    expect(prompt).toContain("user applies");
  });

  it("teaches run as powerful JS, not a lesser bash", () => {
    const prompt = codingAgentPrompt("demo");

    expect(prompt).toContain("JavaScript");
    expect(prompt).toContain("env.WORKSPACE");
    // honest about limits
    expect(prompt).toContain("not a shell");
  });
});
