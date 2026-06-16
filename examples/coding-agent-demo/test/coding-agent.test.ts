import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/agent/prompt";
import { CODING_TOOLS, CODING_TOOL_NAMES, codingToolDescription } from "../src/agent/tools";

describe("coding agent", () => {
  it("exposes the stable read, write, edit, and run tools", () => {
    expect(CODING_TOOL_NAMES).toEqual(["read", "write", "edit", "run"]);
    expect(codingToolDescription("run")).toContain("JavaScript program");
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

    for (const term of ["Think", "session", "copy ID", "RPC", "R2", "SQLite", "Durable Object", "runWorkspaceWorker", "applyWorkingCopy", "discardWorkingCopy"]) {
      expect(prompt).not.toContain(term);
    }
  });

  it("teaches working copy semantics and user-controlled publication", () => {
    const prompt = buildSystemPrompt("demo", CODING_TOOLS);

    expect(prompt).toContain("working copy");
    expect(prompt).toContain("user applies");
    expect(prompt).not.toContain("changes are staged");
  });

  it("teaches run as powerful JS and hides unavailable Sandbox tools", () => {
    const prompt = buildSystemPrompt("demo", CODING_TOOLS);

    expect(prompt).toContain("JavaScript");
    expect(prompt).toContain("env.WORKSPACE");
    expect(prompt).toContain("not a shell");
    expect(prompt).not.toContain("shell command");
    expect(prompt).not.toContain("package managers, test runners, native tools");
  });

  it("teaches that the workspace name is not a repository path", () => {
    const prompt = buildSystemPrompt("coding-demo2222", CODING_TOOLS);

    expect(prompt).toContain("coding-demo2222");
    expect(prompt).toContain("not a filesystem path");
    expect(prompt).toContain("repository root is /");
  });
});
