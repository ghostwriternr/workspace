import { describe, expect, it } from "vitest";

import { codingAgentPrompt } from "../src/agent/prompt";
import { CODING_TOOL_NAMES } from "../src/agent/tools";

describe("coding agent", () => {
  it("declares one Workspace Worker tool plus edit publication actions", () => {
    expect(CODING_TOOL_NAMES).toEqual(["runWorkspaceWorker", "applyEdit", "discardEdit"]);
  });

  it("directs delegated code through the Workspace Worker tool", () => {
    const prompt = codingAgentPrompt("demo-workspace");

    expect(prompt).toContain("demo-workspace");
    expect(prompt).toContain("Use runWorkspaceWorker for inspection and edits");
    expect(prompt).toContain("Only apply edits when the user clearly asks");
    expect(prompt).not.toContain("Use listRepoState");
    expect(prompt).not.toContain("runDynamicWorker");
    expect(prompt).not.toContain("runSandboxCommand");
  });
});
