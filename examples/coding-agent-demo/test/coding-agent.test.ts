import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

async function readProjectFile(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

describe("coding agent slice", () => {
  it("wires the CodingAgent runtime before fallback responses", async () => {
    const index = await readProjectFile("src/index.ts");
    const viteConfig = await readProjectFile("vite.config.ts");
    const repoImport = await readProjectFile("src/http/repo-import.ts");
    const config = JSON.parse(await readProjectFile("wrangler.jsonc"));

    expect(index).toContain("routeAgentRequest(request, env)");
    expect(index).toContain("export { CodingAgent }");
    expect(index).toContain("export { WorkspaceFileCapability }");
    expect(index).toContain("handleRepoImportRequest(");
    expect(index).toContain("{ workspaces: env.WORKSPACES, githubToken: optionalGithubToken(env) }");
    expect(index.indexOf("handleRepoImportRequest(")).toBeLessThan(index.indexOf("routeAgentRequest(request, env)"));
    expect(repoImport).toContain("runtime: RepoImportRuntime");
    expect(repoImport).not.toContain("runtimeOrWorkspaces");
    expect(repoImport).not.toContain("repoImportRuntime");
    expect(config.assets.run_worker_first).toContain("/agents/*");
    expect(viteConfig).toContain('import agents from "agents/vite"');
    expect(viteConfig).toContain("agents(),");
    expect(config.compatibility_flags).toContain("experimental");
    expect(config.worker_loaders).toEqual([{ binding: "DYNAMIC_WORKERS" }]);
    expect(config.durable_objects.bindings).toContainEqual({ name: "CodingAgent", class_name: "CodingAgent" });
  });

  it("exposes one Workspace Worker tool through Think", async () => {
    const agent = await readProjectFile("src/agent/coding-agent.ts");
    const prompt = await readProjectFile("src/agent/prompt.ts");
    const config = JSON.parse(await readProjectFile("wrangler.jsonc"));

    expect(agent).toContain("class CodingAgent extends Think<Env, CodingAgentState>");
    expect(agent).toContain("getModel()");
    expect(agent).toContain("getSystemPrompt()");
    expect(agent).toContain("getTools(): ToolSet");
    expect(agent).not.toContain("repo?: RepoState");
    expect(agent).toContain('const codingToolNames = ["runWorkspaceWorker", "applyEdit", "discardEdit"] as const;');
    expect(agent).toContain('"listRepoState"');
    expect(agent).not.toContain("listRepoState: tool(");
    expect(agent).toContain("runWorkspaceWorker: tool");
    expect(agent).toContain('"applyEdit"');
    expect(agent).toContain('"discardEdit"');
    expect(agent).toContain("async refreshRepoState");
    expect(agent).not.toContain("runSandboxCommand");
    expect(prompt).toContain("Use runWorkspaceWorker for inspection and edits");
    expect(prompt).not.toContain("Use listRepoState");
    expect(prompt).not.toContain("runDynamicWorker");
    expect(prompt).toContain("Only apply edits when the user clearly asks");
    expect(config.ai).toEqual({ binding: "AI" });
  });
});
