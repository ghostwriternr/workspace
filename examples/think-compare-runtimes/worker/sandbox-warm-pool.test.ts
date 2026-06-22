import { describe, expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {},
}));

vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: vi.fn(),
}));

import { createDurableSandboxWarmPool } from "./sandbox-warm-pool";

describe("createDurableSandboxWarmPool", () => {
  test("leases and releases containers through the durable pool handle", async () => {
    const calls: unknown[] = [];
    const namespace = {
      getByName(name: string) {
        calls.push(["getByName", name]);
        return {
          async getContainer(logicalId: string) {
            calls.push(["getContainer", logicalId]);
            return "container-1";
          },
          async releaseContainer(logicalId: string) {
            calls.push(["releaseContainer", logicalId]);
          },
        };
      },
    };

    const pool = createDurableSandboxWarmPool(namespace as never, "run-1:workspace");
    const lease = await pool.lease();
    await pool.release(lease);

    expect(lease).toEqual({ id: "container-1", logicalId: "run-1:workspace:0" });
    expect(calls).toEqual([
      ["getByName", "default"],
      ["getContainer", "run-1:workspace:0"],
      ["releaseContainer", "run-1:workspace:0"],
    ]);
  });
});
