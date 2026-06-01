import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

async function readProjectFile(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

describe("coding agent slice", () => {
  it("wires the CodingAgent runtime before fallback responses", async () => {
    const index = await readProjectFile("src/index.ts");
    const config = JSON.parse(await readProjectFile("wrangler.jsonc"));

    expect(index).toContain("routeAgentRequest(request, env)");
    expect(index).toContain("export { CodingAgent }");
    expect(index).toContain("export { WorkspaceFileCapability }");
    expect(index.indexOf("handleRepoImportRequest(request, env.WORKSPACES, env.CodingAgent)")).toBeLessThan(
      index.indexOf("routeAgentRequest(request, env)"),
    );
    expect(config.assets.run_worker_first).toContain("/agents/*");
    expect(config.compatibility_flags).toContain("experimental");
    expect(config.worker_loaders).toEqual([{ binding: "DYNAMIC_WORKERS" }]);
    expect(config.durable_objects.bindings).toContainEqual({ name: "CodingAgent", class_name: "CodingAgent" });
  });

  it("exposes repo state and Dynamic Worker tools through Think", async () => {
    const agent = await readProjectFile("src/agent/coding-agent.ts");
    const prompt = await readProjectFile("src/agent/prompt.ts");
    const config = JSON.parse(await readProjectFile("wrangler.jsonc"));

    expect(agent).toContain("class CodingAgent extends Think<Env, CodingAgentState>");
    expect(agent).toContain("getModel()");
    expect(agent).toContain("getSystemPrompt()");
    expect(agent).toContain("getTools(): ToolSet");
    expect(agent).not.toContain("repo?: RepoState");
    expect(agent).toContain('"listRepoState"');
    expect(agent).toContain('"runDynamicWorker"');
    expect(agent).toContain('"applyEdit"');
    expect(agent).toContain('"discardEdit"');
    expect(agent).toContain("async refreshRepoState");
    expect(agent).not.toContain("runSandboxCommand");
    expect(prompt).toContain("Dynamic Worker");
    expect(prompt).toContain("Only apply edits when the user clearly asks");
    expect(config.ai).toEqual({ binding: "AI" });
  });
});
