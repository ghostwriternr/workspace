import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

describe("wrangler config", () => {
  test("binds the raw Sandbox container runtime", () => {
    expect(config.vars).toMatchObject({ SANDBOX_TRANSPORT: "rpc" });
    expect(config.containers).toEqual([
      expect.objectContaining({
        class_name: "Sandbox",
        image: "./Dockerfile",
        instance_type: "standard-1",
      }),
    ]);
    expect(config.durable_objects.bindings).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Sandbox", class_name: "Sandbox" })]),
    );
    expect(config.migrations).toEqual([
      expect.objectContaining({ tag: "v1", new_sqlite_classes: expect.arrayContaining(["Sandbox"]) }),
    ]);
  });
});
