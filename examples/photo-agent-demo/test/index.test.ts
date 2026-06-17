import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";

import { handleDemoRequest } from "../src/http/demo";

describe("photo agent demo worker", () => {
  it("returns a health response", async () => {
    const response = handleDemoRequest(new Request("http://example.com/health"));

    expect(response).toBeDefined();

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ ok: true });
  });

  it("routes demo endpoints ahead of agent requests", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");

    const demoRouteIndex = source.indexOf("const demoResponse = handleDemoRequest(request)");
    const agentRouteIndex = source.indexOf("routeAgentRequest(request, env)");

    expect(demoRouteIndex).toBeGreaterThan(-1);
    expect(agentRouteIndex).toBeGreaterThan(demoRouteIndex);
  });

  it("uses the Workspace Sandbox Worker base", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");

    expect(source).toContain("@cloudflare/workspace-adapter-sandbox/workers");
    expect(source).toContain("extends WorkspaceSandbox<Env>");
    expect(source).not.toContain("static outboundHandlers =");
  });

  it("describes the wired demo capabilities", async () => {
    const response = handleDemoRequest(
      new Request("http://example.com/api/demo-capabilities"),
    );

    expect(response).toBeDefined();

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      agent: "Think",
      execution: "Sandbox/ImageMagick and Dynamic Workers",
      state: "Workspace durable files",
      durability: "make draft current or discard",
    });
  });

  it("offers Sandbox and Dynamic Worker tools over the same draft", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/agent/photo-agent.ts", import.meta.url)), "utf8");

    expect(source).toContain('"runWorkspaceCommand"');
    expect(source).toContain('"runDynamicWorker"');
    expect(source).toContain("this.controller().runDynamicWorker");
  });

  it("keeps draft publication out of active model tools", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/agent/photo-agent.ts", import.meta.url)), "utf8");
    const activeTools = source.slice(
      source.indexOf("const photoToolNames"),
      source.indexOf("];") + 2,
    );

    expect(activeTools).not.toContain('"commitDraft"');
    expect(activeTools).not.toContain('"discardDraft"');
    expect(source).toContain("@callable()\n  async commitDraft");
    expect(source).toContain("@callable()\n  async discardDraft");
  });

  it("enables the compatibility flag required by Dynamic Worker loader capabilities", async () => {
    const config = JSON.parse(
      await readFile(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), "utf8"),
    );

    expect(config.worker_loaders).toEqual([{ binding: "DYNAMIC_WORKERS" }]);
    expect(config.compatibility_flags).toContain("experimental");
  });

  it("uses a standard sandbox capacity for concurrent image edits", async () => {
    const config = JSON.parse(
      await readFile(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), "utf8"),
    );

    expect(config.containers).toContainEqual(
      expect.objectContaining({
        class_name: "Sandbox",
        instance_type: "standard-1",
        max_instances: 10,
      }),
    );
  });

  it("keeps non-agent unknown API routes explicit", async () => {
    const response = handleDemoRequest(new Request("http://example.com/api/missing"));

    expect(response).toBeDefined();

    expect(response?.status).toBe(404);
    await expect(response?.text()).resolves.toBe("Not found");
  });

  it("leaves non-demo routes for the Worker runtime", () => {
    const response = handleDemoRequest(new Request("http://example.com/agents/photo/default"));

    expect(response).toBeUndefined();
  });
});
