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
    expect(index.indexOf("handleRepoImportRequest(request, env.WORKSPACES, env.CodingAgent)")).toBeLessThan(
      index.indexOf("routeAgentRequest(request, env)"),
    );
    expect(config.assets.run_worker_first).toContain("/agents/*");
    expect(config.durable_objects.bindings).toContainEqual({ name: "CodingAgent", class_name: "CodingAgent" });
  });

  it("exposes listRepoState as the first CodingAgent action", async () => {
    const agent = await readProjectFile("src/agent/coding-agent.ts");

    expect(agent).toContain("class CodingAgent extends Agent<Env, CodingAgentState>");
    expect(agent).toContain('static readonly actions = ["listRepoState"]');
    expect(agent).toContain("async listRepoState()");
    expect(agent).not.toContain("runDynamicWorker");
    expect(agent).not.toContain("runSandboxCommand");
  });
});
