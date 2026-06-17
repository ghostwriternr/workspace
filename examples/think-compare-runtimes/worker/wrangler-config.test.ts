import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const workerSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("wrangler config", () => {
  test("binds the comparison runtime resources", () => {
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(["/api/*", "/health"]));
    expect(config.vars).toMatchObject({ SANDBOX_TRANSPORT: "rpc" });
    expect(config.containers).toEqual([
      expect.objectContaining({
        class_name: "Sandbox",
        image: "./Dockerfile",
        instance_type: "standard-1",
      }),
    ]);
    expect(config.artifacts).toEqual([
      expect.objectContaining({ binding: "ARTIFACTS", namespace: "workspace-think-compare-runtimes", remote: true }),
    ]);
    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.services).toEqual([
      expect.objectContaining({ binding: "SELF", service: "workspace-think-compare-runtimes" }),
    ]);
    expect(config.worker_loaders).toEqual([expect.objectContaining({ binding: "DYNAMIC_WORKERS" })]);
    expect(config.durable_objects.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Sandbox", class_name: "Sandbox" }),
        expect.objectContaining({ name: "WORKSPACE_OBJECTS", class_name: "WorkspaceObject" }),
        expect.objectContaining({ name: "CompareRun", class_name: "CompareRun" }),
        expect.objectContaining({ name: "WorkspaceRuntimeAgent", class_name: "WorkspaceRuntimeAgent" }),
        expect.objectContaining({ name: "SandboxRuntimeAgent", class_name: "SandboxRuntimeAgent" }),
      ]),
    );
    expect(config.migrations).toEqual([
      expect.objectContaining({
        tag: "v1",
        new_sqlite_classes: expect.arrayContaining(["Sandbox", "WorkspaceObject"]),
      }),
      expect.objectContaining({
        tag: "v2",
        new_sqlite_classes: expect.arrayContaining(["WorkspaceRuntimeAgent", "SandboxRuntimeAgent"]),
      }),
      expect.objectContaining({
        tag: "v3",
        new_sqlite_classes: expect.arrayContaining(["CompareRun"]),
      }),
    ]);
  });
});
