import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { UI_COPY } from "../src/client/ui-copy";

async function readProjectFile(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

describe("coding demo browser UI", () => {
  it("describes import, chat, and passive Workspace state", () => {
    expect(UI_COPY.title).toBe("Workspace Coding Agent Demo");
    expect(UI_COPY.importLabel).toBe("GitHub repository");
    expect(UI_COPY.importPlaceholder).toBe("owner/repo");
    expect(UI_COPY.importAction).toBe("Import repo");
    expect(UI_COPY.filesTitle).toBe("Workspace files");
    expect(UI_COPY.activeEditLabel).toBe("Active edit copy");
    expect(UI_COPY.applyEditAction).toBe("Apply edit");
    expect(UI_COPY.discardEditAction).toBe("Discard edit");
    expect(UI_COPY.chatTitle).toBe("Coding agent");
    expect(UI_COPY.chatPlaceholder).toBe("Ask the agent to inspect or edit this repo…");
  });

  it("uses Agents chat hooks and renders tool activity", async () => {
    const client = await readProjectFile("src/client/App.tsx");

    expect(client).toContain('useAgent<CodingAgentState>');
    expect(client).toContain("useAgentChat");
    expect(client).toContain("sendMessage");
    expect(client).toContain("isToolUIPart(part)");
    expect(client).toContain("getToolName(part)");
    expect(client).toContain("getToolInput(part)");
    expect(client).toContain("getToolOutput(part)");
    expect(client).toContain("Tool result");
    expect(client).not.toContain("setMessages(");
  });
});
