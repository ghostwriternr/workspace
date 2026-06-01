import { describe, expect, it } from "vitest";

import { codingAgentPrompt } from "../src/agent/prompt";
import { CODING_TOOL_NAMES } from "../src/agent/tools";

describe("coding agent", () => {
  it("exposes a small Pi-like Workspace toolbelt", () => {
    expect(CODING_TOOL_NAMES).toEqual(["read", "write", "edit", "run"]);
  });

  it("describes Workspace files as durable state and Dynamic Workers as execution", () => {
    const prompt = codingAgentPrompt("demo-workspace");

    expect(prompt).toContain("demo-workspace");
    expect(prompt).toContain("Use read, write, edit, and run");
    expect(prompt).toContain("env.WORKSPACE binding exposes readFile, writeFile, list, and stat");
    expect(prompt).toContain("methods also return { status: 'ok', value } or { status: 'error', error } objects");
    expect(prompt).toContain("Leave changes in the active edit copy for the user to apply or discard");
    expect(prompt).not.toContain("Use listRepoState");
    expect(prompt).not.toContain("applyEdit");
    expect(prompt).not.toContain("discardEdit");
    expect(prompt).not.toContain("runWorkspaceWorker");
    expect(prompt).not.toContain("runDynamicWorker");
    expect(prompt).not.toContain("runSandboxCommand");
  });
});
