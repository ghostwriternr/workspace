import { describe, expect, test } from "vitest";

import { createSandboxWarmPool } from "./sandbox-warm-pool";

describe("createSandboxWarmPool", () => {
  test("leases and releases warm sandbox identifiers", async () => {
    const pool = createSandboxWarmPool({ prefix: "workspace", size: 2 });

    const first = await pool.lease();
    const second = await pool.lease();

    expect(first).toEqual({ id: "workspace-0" });
    expect(second).toEqual({ id: "workspace-1" });
    expect(pool.status()).toEqual({ size: 2, available: 0, leased: 2 });

    await pool.release(first);

    expect(pool.status()).toEqual({ size: 2, available: 1, leased: 1 });
    await expect(pool.lease()).resolves.toEqual({ id: "workspace-0" });
  });

  test("reports capacity exhaustion as a normal error", async () => {
    const pool = createSandboxWarmPool({ prefix: "raw", size: 1 });

    await pool.lease();

    await expect(pool.lease()).rejects.toThrow("No warm sandboxes available for raw");
  });
});
