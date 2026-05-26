import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

async function readProjectFile(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

describe("photo demo browser UI", () => {
  it("serves a Vite React shell with Agents chat hooks", async () => {
    const html = await readProjectFile("index.html");
    const client = await readProjectFile("src/client/App.tsx");

    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('/src/client/main.tsx');
    expect(html).not.toContain("new WebSocket");
    expect(html).not.toContain("cf_agent_use_chat_request");

    expect(client).toContain('useAgent<PhotoAgentState>');
    expect(client).toContain("agent.call(\"refreshPhotoState\")");
    expect(client).toContain("useAgentChat");
    expect(client).toContain("sendMessage");
    expect(client).toContain('key={workspaceName}');
    expect(client).not.toContain("setMessages([])");
    expect(client).not.toContain("new WebSocket");
  });

  it("keeps upload concrete and previews passive", async () => {
    const client = await readProjectFile("src/client/App.tsx");

    expect(client).toContain("Upload original");
    expect(client).toContain("Original");
    expect(client).toContain("Draft edit");
    expect(client).toContain("Current");
    expect(client).toContain("URL.createObjectURL");
    expect(client).toContain("Workspace state");
    expect(client).not.toContain("setInterval");
    expect(client).not.toContain("photo-state");
    expect(client).not.toContain("demo/");
    expect(client).not.toContain("operation-button");
  });

  it("renders streamed message parts as text, tool cards, results, and reasoning", async () => {
    const client = await readProjectFile("src/client/App.tsx");

    expect(client).toContain('part.type === "text"');
    expect(client).toContain('part.type === "reasoning"');
    expect(client).toContain("isToolUIPart(part)");
    expect(client).toContain("getToolName(part)");
    expect(client).toContain("getToolInput(part)");
    expect(client).toContain("getToolOutput(part)");
    expect(client).toContain('toolName === "runWorkspaceCommand"');
    expect(client).toContain("Tool result");
  });
});
