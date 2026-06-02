import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/agent/prompt";
import { CODING_TOOLS } from "../src/agent/tools";

describe("coding agent", () => {
  it("exposes read, write, edit, and run", () => {
    expect(CODING_TOOLS.map((t) => t.name)).toEqual(["read", "write", "edit", "run"]);
  });

  it("assembles system prompt from tool snippets and guidelines", () => {
    const prompt = buildSystemPrompt("demo", CODING_TOOLS);

    // tool snippets appear in "Available tools:" section
    for (const tool of CODING_TOOLS) {
      expect(prompt).toContain(`- ${tool.name}: ${tool.promptSnippet}`);
    }

    // tool guidelines appear in "Guidelines:" section
    for (const tool of CODING_TOOLS) {
      for (const guideline of tool.promptGuidelines) {
        expect(prompt).toContain(`- ${guideline}`);
      }
    }
  });

  it("does not leak implementation details into the prompt", () => {
    const prompt = buildSystemPrompt("demo", CODING_TOOLS);

    for (const term of ["Think", "session", "copy ID", "RPC", "R2", "SQLite", "Durable Object", "runWorkspaceWorker", "applyEdit", "discardEdit"]) {
      expect(prompt).not.toContain(term);
    }
  });

  it("teaches staged-copy semantics and user-controlled publication", () => {
    const prompt = buildSystemPrompt("demo", CODING_TOOLS);

    expect(prompt).toContain("staged");
    expect(prompt).toContain("user applies");
  });

  it("teaches run as powerful JS, not a lesser bash", () => {
    const prompt = buildSystemPrompt("demo", CODING_TOOLS);

    expect(prompt).toContain("JavaScript");
    expect(prompt).toContain("env.WORKSPACE");
    expect(prompt).toContain("not a shell");
  });
});
